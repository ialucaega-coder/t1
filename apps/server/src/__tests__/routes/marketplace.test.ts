/**
 * Pruebas de integracion para las rutas de marketplace
 * (`src/routes/marketplace.ts`): listado de items con seed de defaults,
 * filtros por categoria/busqueda, marca de "installed" por negocio, e
 * instalar/desinstalar con scope por businessId.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth setea req.auth).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    marketplaceItem: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    marketplaceInstall: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (!roles.includes(req.auth?.role ?? '')) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    },
}));

import { prisma } from '../../lib/prisma';
import { marketplaceRouter } from '../../routes/marketplace';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/marketplace', marketplaceRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/marketplace', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto ya hay items sembrados (no se ejecuta el seed).
    mock(prisma.marketplaceItem.count).mockResolvedValue(8);
    mock(prisma.marketplaceItem.createMany).mockResolvedValue({ count: 8 });
    mock(prisma.marketplaceItem.findMany).mockResolvedValue([]);
    mock(prisma.marketplaceInstall.findMany).mockResolvedValue([]);
  });

  describe('GET /api/marketplace/items', () => {
    it('lista items publicados y marca installed segun el negocio', async () => {
      mock(prisma.marketplaceItem.findMany).mockResolvedValue([
        { id: 'it1', name: 'A' },
        { id: 'it2', name: 'B' },
      ]);
      mock(prisma.marketplaceInstall.findMany).mockResolvedValue([{ itemId: 'it1' }]);

      const res = await request(app).get('/api/marketplace/items');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 'it1', name: 'A', installed: true },
        { id: 'it2', name: 'B', installed: false },
      ]);
      expect(prisma.marketplaceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPublished: true } })
      );
      expect(prisma.marketplaceInstall.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });

    it('siembra los defaults cuando no hay items (count === 0)', async () => {
      mock(prisma.marketplaceItem.count).mockResolvedValue(0);

      const res = await request(app).get('/api/marketplace/items');

      expect(res.status).toBe(200);
      expect(prisma.marketplaceItem.createMany).toHaveBeenCalledTimes(1);
    });

    it('no siembra cuando ya existen items (count > 0)', async () => {
      await request(app).get('/api/marketplace/items');

      expect(prisma.marketplaceItem.createMany).not.toHaveBeenCalled();
    });

    it('filtra por categoria cuando se pasa ?category (distinto de Todos)', async () => {
      await request(app).get('/api/marketplace/items').query({ category: 'Salud' });

      expect(prisma.marketplaceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isPublished: true, category: 'Salud' }),
        })
      );
    });

    it('ignora el filtro de categoria cuando es "Todos"', async () => {
      await request(app).get('/api/marketplace/items').query({ category: 'Todos' });

      expect(prisma.marketplaceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPublished: true } })
      );
    });

    it('filtra por nombre cuando se pasa ?search', async () => {
      await request(app).get('/api/marketplace/items').query({ search: 'menu' });

      expect(prisma.marketplaceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPublished: true,
            name: { contains: 'menu', mode: 'insensitive' },
          }),
        })
      );
    });
  });

  describe('POST /api/marketplace/items/:id/install', () => {
    it('instala el item cuando no estaba instalado (201)', async () => {
      mock(prisma.marketplaceInstall.findUnique).mockResolvedValue(null);
      mock(prisma.marketplaceInstall.create).mockResolvedValue({ id: 'inst1' });

      const res = await request(app).post('/api/marketplace/items/it1/install');

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });
      expect(prisma.marketplaceInstall.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { itemId: 'it1', businessId: 'biz_1' },
        })
      );
    });

    it('devuelve 409 si el item ya estaba instalado', async () => {
      mock(prisma.marketplaceInstall.findUnique).mockResolvedValue({ id: 'inst1' });

      const res = await request(app).post('/api/marketplace/items/it1/install');

      expect(res.status).toBe(409);
      expect(prisma.marketplaceInstall.create).not.toHaveBeenCalled();
    });

    it('busca el install con clave compuesta itemId_businessId (scope por negocio)', async () => {
      mock(prisma.marketplaceInstall.findUnique).mockResolvedValue(null);
      mock(prisma.marketplaceInstall.create).mockResolvedValue({ id: 'inst1' });

      await request(app).post('/api/marketplace/items/it1/install');

      expect(prisma.marketplaceInstall.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId_businessId: { itemId: 'it1', businessId: 'biz_1' } },
        })
      );
    });
  });

  describe('DELETE /api/marketplace/items/:id/install', () => {
    it('desinstala el item con scope por negocio (204)', async () => {
      mock(prisma.marketplaceInstall.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/marketplace/items/it1/install');

      expect(res.status).toBe(204);
      expect(prisma.marketplaceInstall.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { itemId: 'it1', businessId: 'biz_1' } })
      );
    });
  });
});
