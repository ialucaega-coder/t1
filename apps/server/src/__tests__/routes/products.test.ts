/**
 * Pruebas de integracion para las rutas de productos
 * (`src/routes/products.ts`): listado (array plano vs. paginado con scope
 * por negocio), creacion (201 + validacion 400) y aislamiento multi-tenant
 * en update/delete (el where usa businessId del auth).
 *
 * Se mockean Prisma y el middleware de auth (requireAuth + requireRole).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
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
import { productsRouter } from '../../routes/products';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/products', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/products', () => {
    it('devuelve el array plano de productos del negocio (sin paginacion)', async () => {
      mock(prisma.product.findMany).mockResolvedValue([{ id: 'p1', name: 'Shampoo' }]);

      const res = await request(app).get('/api/products');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });

    it('devuelve la respuesta paginada estandar cuando se pasa ?page', async () => {
      mock(prisma.product.findMany).mockResolvedValue([{ id: 'p1' }]);
      mock(prisma.product.count).mockResolvedValue(1);

      const res = await request(app).get('/api/products').query({ page: '2', limit: '10' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 2, limit: 10, totalPages: 1 });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10, where: { businessId: 'biz_1' } })
      );
    });
  });

  describe('POST /api/products', () => {
    const validPayload = { name: 'Shampoo', price: 1500 };

    it('crea un producto (201) inyectando el businessId del auth', async () => {
      mock(prisma.product.create).mockResolvedValue({ id: 'p1', ...validPayload });

      const res = await request(app).post('/api/products').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Shampoo', price: 1500, businessId: 'biz_1' }),
        })
      );
    });

    it('devuelve 400 cuando falta el precio (validacion Zod)', async () => {
      const res = await request(app).post('/api/products').send({ name: 'Shampoo' });

      expect(res.status).toBe(400);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 con precio no positivo', async () => {
      const res = await request(app).post('/api/products').send({ name: 'Shampoo', price: -5 });

      expect(res.status).toBe(400);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/products/:id', () => {
    it('actualiza un producto con scope por businessId (anti cross-tenant)', async () => {
      mock(prisma.product.update).mockResolvedValue({ id: 'p1', name: 'Nuevo' });

      const res = await request(app).put('/api/products/p1').send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1', businessId: 'biz_1' },
          data: expect.objectContaining({ name: 'Nuevo' }),
        })
      );
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('elimina el producto cuando existe en el negocio', async () => {
      mock(prisma.product.findFirst).mockResolvedValue({ id: 'p1' });
      mock(prisma.product.delete).mockResolvedValue({});

      const res = await request(app).delete('/api/products/p1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', businessId: 'biz_1' } })
      );
      expect(prisma.product.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' } })
      );
    });

    it('devuelve 404 si el producto no pertenece al negocio', async () => {
      mock(prisma.product.findFirst).mockResolvedValue(null);

      const res = await request(app).delete('/api/products/de-otro-negocio');

      expect(res.status).toBe(404);
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });
  });
});
