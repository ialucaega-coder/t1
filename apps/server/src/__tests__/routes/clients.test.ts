/**
 * Pruebas de integracion para las rutas de clientes
 * (`src/routes/clients.ts`): listado con scope por negocio, lectura,
 * creacion (con validacion y anti-duplicado), y aislamiento multi-tenant.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth setea req.auth).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
import { clientsRouter } from '../../routes/clients';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', clientsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/clients', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/clients', () => {
    it('devuelve la lista paginada con scope por businessId, role CLIENT y no borrados', async () => {
      mock(prisma.user.findMany).mockResolvedValue([{ id: 'c1', name: 'Ana' }]);
      mock(prisma.user.count).mockResolvedValue(1);

      const res = await request(app).get('/api/clients');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
      expect(res.body.data).toHaveLength(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1', role: 'CLIENT', deletedAt: null },
        })
      );
    });

    it('agrega el filtro OR de busqueda cuando se pasa ?search', async () => {
      mock(prisma.user.findMany).mockResolvedValue([]);
      mock(prisma.user.count).mockResolvedValue(0);

      await request(app).get('/api/clients').query({ search: 'ana' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            OR: expect.arrayContaining([
              expect.objectContaining({ name: { contains: 'ana', mode: 'insensitive' } }),
            ]),
          }),
        })
      );
    });

    it('respeta la paginacion page/pageSize (skip/take)', async () => {
      mock(prisma.user.findMany).mockResolvedValue([]);
      mock(prisma.user.count).mockResolvedValue(0);

      await request(app).get('/api/clients').query({ page: '3', pageSize: '10' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  describe('GET /api/clients/:id', () => {
    it('devuelve el cliente cuando existe (scope por businessId)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1', name: 'Ana' });

      const res = await request(app).get('/api/clients/c1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'c1' });
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'c1',
            businessId: 'biz_1',
            role: 'CLIENT',
            deletedAt: null,
          }),
        })
      );
    });

    it('devuelve 404 si el cliente no pertenece al negocio (anti cross-tenant)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      const res = await request(app).get('/api/clients/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/clients', () => {
    const validPayload = { name: 'Ana Perez', email: 'ana@example.com' };

    it('crea un cliente con datos validos (201) inyectando el businessId del auth', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null); // no existe email previo
      mock(prisma.user.create).mockResolvedValue({ id: 'c1', ...validPayload });

      const res = await request(app).post('/api/clients').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Ana Perez',
            email: 'ana@example.com',
            role: 'CLIENT',
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 409 si ya existe un cliente con ese email', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'existente' });

      const res = await request(app).post('/api/clients').send(validPayload);

      expect(res.status).toBe(409);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando falta el email (validacion Zod)', async () => {
      const res = await request(app).post('/api/clients').send({ name: 'Ana Perez' });

      expect(res.status).toBe(400);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/clients/:id', () => {
    it('actualiza un cliente existente (scope por businessId)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1', name: 'Ana Nueva' });

      const res = await request(app).patch('/api/clients/c1').send({ name: 'Ana Nueva' });

      expect(res.status).toBe(200);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'c1', businessId: 'biz_1', role: 'CLIENT' }),
        })
      );
    });

    it('devuelve 404 si el cliente no existe en el negocio', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      const res = await request(app).patch('/api/clients/no-existe').send({ name: 'Nuevo' });

      expect(res.status).toBe(404);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/clients/:id', () => {
    it('hace soft-delete (setea deletedAt) cuando el cliente existe', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1', deletedAt: new Date() });

      const res = await request(app).delete('/api/clients/c1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        })
      );
    });

    it('devuelve 404 si el cliente no existe en el negocio', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      const res = await request(app).delete('/api/clients/no-existe');

      expect(res.status).toBe(404);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
