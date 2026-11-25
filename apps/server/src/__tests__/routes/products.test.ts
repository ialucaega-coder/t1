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
    category: { findFirst: vi.fn() },
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
        expect.objectContaining({ where: { businessId: 'biz_1', deletedAt: null } })
      );
    });

    it('devuelve la respuesta paginada estandar cuando se pasa ?page', async () => {
      mock(prisma.product.findMany).mockResolvedValue([{ id: 'p1' }]);
      mock(prisma.product.count).mockResolvedValue(1);

      const res = await request(app).get('/api/products').query({ page: '2', limit: '10' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 2, limit: 10, totalPages: 1 });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10, where: { businessId: 'biz_1', deletedAt: null } })
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

  describe('image, sortOrder y categoria', () => {
    it('POST acepta image https y sortOrder entero y los guarda', async () => {
      mock(prisma.product.create).mockResolvedValue({ id: 'p1' });

      const res = await request(app)
        .post('/api/products')
        .send({ name: 'Shampoo', price: 1500, image: 'https://cdn.example.com/a.png', sortOrder: 3 });

      expect(res.status).toBe(201);
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ image: 'https://cdn.example.com/a.png', sortOrder: 3 }),
        })
      );
    });

    it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://x.com/a.png', 'ftp://x.com/a.png'])(
      'POST rechaza image %s',
      async (image) => {
        const res = await request(app).post('/api/products').send({ name: 'Shampoo', price: 1500, image });
        expect(res.status).toBe(400);
        expect(prisma.product.create).not.toHaveBeenCalled();
      }
    );

    it('POST rechaza sortOrder no entero', async () => {
      const res = await request(app).post('/api/products').send({ name: 'Shampoo', price: 1500, sortOrder: 1.5 });
      expect(res.status).toBe(400);
    });

    it('POST rechaza una categoria de otro negocio (multi-tenant)', async () => {
      mock(prisma.category.findFirst).mockResolvedValue(null);

      const res = await request(app).post('/api/products').send({ name: 'Shampoo', price: 1500, categoryId: 'cat_ajena' });

      expect(res.status).toBe(400);
      expect(prisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cat_ajena', businessId: 'biz_1' } })
      );
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('PUT permite quitar la imagen y la categoria con null', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.product.findFirst).mockResolvedValue({ id: 'p1' });

      const res = await request(app).put('/api/products/p1').send({ image: null, categoryId: null });

      expect(res.status).toBe(200);
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { image: null, categoryId: null } })
      );
    });

    it('PUT rechaza una imagen javascript:', async () => {
      const res = await request(app).put('/api/products/p1').send({ image: 'javascript:alert(1)' });
      expect(res.status).toBe(400);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('PUT rechaza una categoria de otro negocio', async () => {
      mock(prisma.category.findFirst).mockResolvedValue(null);
      const res = await request(app).put('/api/products/p1').send({ categoryId: 'cat_ajena' });
      expect(res.status).toBe(400);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/products/:id', () => {
    it('actualiza un producto con scope por businessId y sin tocar los dados de baja (anti cross-tenant)', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.product.findFirst).mockResolvedValue({ id: 'p1', name: 'Nuevo' });

      const res = await request(app).put('/api/products/p1').send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Nuevo');
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', businessId: 'biz_1', deletedAt: null },
        data: { name: 'Nuevo' },
      });
    });

    it('devuelve 404 si el producto no es del negocio o esta dado de baja', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 0 });
      mock(prisma.product.findFirst).mockResolvedValue(null);

      const res = await request(app).put('/api/products/ajeno').send({ name: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT con expectedUpdatedAt (concurrencia optimista, stock)', () => {
    const iso = '2026-11-15T10:00:00.000Z';

    it('aplica el update solo si el updatedAt coincide (condicion en el where) y no guarda expectedUpdatedAt', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.product.findFirst).mockResolvedValue({ id: 'p1', stock: 10 });

      const res = await request(app).put('/api/products/p1').send({ stock: 10, expectedUpdatedAt: iso });

      expect(res.status).toBe(200);
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', businessId: 'biz_1', deletedAt: null, updatedAt: new Date(iso) },
        data: { stock: 10 },
      });
    });

    it('devuelve 409 si el producto cambio (una venta desconto stock) y NO pisa el stock', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 0 });
      mock(prisma.product.findFirst).mockResolvedValue({ id: 'p1' }); // existe: es un conflicto, no un 404

      const res = await request(app).put('/api/products/p1').send({ stock: 10, expectedUpdatedAt: iso });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('El producto cambió mientras lo editabas: recargá');
      expect(res.body.code).toBe('PRODUCT_STALE');
    });

    it('sin expectedUpdatedAt el PUT sigue funcionando (retrocompatible)', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.product.findFirst).mockResolvedValue({ id: 'p1' });

      const res = await request(app).put('/api/products/p1').send({ stock: 4 });

      expect(res.status).toBe(200);
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', businessId: 'biz_1', deletedAt: null },
        data: { stock: 4 },
      });
    });

    it('rechaza un expectedUpdatedAt que no es una fecha ISO', async () => {
      const res = await request(app).put('/api/products/p1').send({ stock: 4, expectedUpdatedAt: 'ayer' });
      expect(res.status).toBe(400);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('topes de precio y stock', () => {
    it('rechaza un precio mayor al maximo de la columna Decimal(10,2)', async () => {
      const res = await request(app).post('/api/products').send({ name: 'X', price: 100_000_000 });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain('El precio no puede superar 99.999.999,99');
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('acepta exactamente el precio maximo', async () => {
      mock(prisma.product.create).mockResolvedValue({ id: 'p1' });
      const res = await request(app).post('/api/products').send({ name: 'X', price: 99_999_999.99 });
      expect(res.status).toBe(201);
    });

    it('rechaza un stock mayor al tope', async () => {
      const res = await request(app).post('/api/products').send({ name: 'X', price: 10, stock: 1_000_001 });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain('El stock no puede superar 1.000.000');
    });

    it('rechaza un stock que desborda el Int (PUT)', async () => {
      const res = await request(app).put('/api/products/p1').send({ stock: 3_000_000_000 });
      expect(res.status).toBe(400);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza un stock no entero', async () => {
      const res = await request(app).post('/api/products').send({ name: 'X', price: 10, stock: 1.5 });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/products/:id (baja logica)', () => {
    it('da de baja el producto (deletedAt + isActive=false) con scope por negocio, sin borrado fisico', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/products/p1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', businessId: 'biz_1', deletedAt: null },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });

    it('devuelve 404 si el producto no pertenece al negocio o ya estaba dado de baja', async () => {
      mock(prisma.product.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app).delete('/api/products/p1');

      expect(res.status).toBe(404);
    });
  });
});
