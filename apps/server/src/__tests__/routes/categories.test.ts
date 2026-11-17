/**
 * Pruebas de integracion para las rutas de categorias (`src/routes/categories.ts`):
 * listado, creacion (ADMIN), actualizacion (ADMIN) y borrado (ADMIN).
 *
 * Se mockea Prisma y se usa el middleware de auth real con JWT firmado para
 * probar 401/403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    category: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    product: { updateMany: vi.fn() },
    service: { updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import { categoriesRouter } from '../../routes/categories';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/categories', categoriesRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/categories', () => {
  const app = buildApp();
  const adminToken = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });
  const clientToken = signToken({ userId: 'user_2', businessId: 'biz_1', role: 'CLIENT' });

  beforeEach(() => {
    vi.clearAllMocks();
    // $transaction real: con callback lo ejecuta con el cliente (mock); con array devuelve las promesas.
    mock(prisma.$transaction).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])
    );
  });

  describe('GET /api/categories', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/categories');
      expect(res.status).toBe(401);
    });

    it('lista las categorias del negocio con conteos', async () => {
      mock(prisma.category.findMany).mockResolvedValue([
        { id: 'cat_1', name: 'Cortes', _count: { services: 2, products: 0 } },
      ]);

      const res = await request(app).get('/api/categories').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1' },
          orderBy: { sortOrder: 'asc' },
          // los productos/servicios dados de baja no cuentan
          include: {
            _count: { select: { services: { where: { deletedAt: null } }, products: { where: { deletedAt: null } } } },
          },
        })
      );
    });

    it('cualquier rol autenticado puede listar (no requiere ADMIN)', async () => {
      mock(prisma.category.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/categories').set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/categories', () => {
    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ name: 'Cortes' });

      expect(res.status).toBe(403);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it('crea una categoria con datos validos', async () => {
      mock(prisma.category.create).mockResolvedValue({ id: 'cat_1', name: 'Cortes' });

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cortes', icon: 'scissors' });

      expect(res.status).toBe(201);
      expect(prisma.category.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Cortes', businessId: 'biz_1', sortOrder: 0 }) })
      );
    });

    it('devuelve 400 cuando falta el nombre', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ icon: 'scissors' });

      expect(res.status).toBe(400);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/categories/:id', () => {
    it('actualiza una categoria existente', async () => {
      mock(prisma.category.findFirst).mockResolvedValue(null);
      mock(prisma.category.update).mockResolvedValue({ id: 'cat_1', name: 'Nuevo' });

      const res = await request(app)
        .put('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Nuevo');
      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cat_1', businessId: 'biz_1' }, data: { name: 'Nuevo' } })
      );
    });

    it('devuelve 403 para rol no ADMIN', async () => {
      const res = await request(app)
        .put('/api/categories/cat_1')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST/PUT: nombre duplicado', () => {
    it('POST devuelve 409 si ya existe una categoria con ese nombre en el negocio', async () => {
      mock(prisma.category.findFirst).mockResolvedValue({ id: 'cat_x' });

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'cortes' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Ya existe una categoría con ese nombre');
      expect(prisma.category.create).not.toHaveBeenCalled();
      expect(prisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ businessId: 'biz_1', name: { equals: 'cortes', mode: 'insensitive' } }),
        })
      );
    });

    it('PUT devuelve 409 si renombra a un nombre que ya usa otra categoria', async () => {
      mock(prisma.category.findFirst).mockResolvedValue({ id: 'cat_2' });

      const res = await request(app)
        .put('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Color' });

      expect(res.status).toBe(409);
      expect(prisma.category.update).not.toHaveBeenCalled();
      expect(prisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ NOT: { id: 'cat_1' } }) })
      );
    });
  });

  describe('lock de nombre (alta/edicion atomica)', () => {
    it('POST toma el advisory lock ANTES de chequear el duplicado y crear, todo en una transaccion', async () => {
      const order: string[] = [];
      mock(prisma.$executeRaw).mockImplementation(async () => { order.push('lock'); });
      mock(prisma.category.findFirst).mockImplementation(async () => { order.push('check'); return null; });
      mock(prisma.category.create).mockImplementation(async () => { order.push('create'); return { id: 'cat_1', name: 'Cortes' }; });

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cortes' });

      expect(res.status).toBe(201);
      expect(order).toEqual(['lock', 'check', 'create']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('la clave del lock es por negocio y category-name', async () => {
      mock(prisma.category.findFirst).mockResolvedValue(null);
      mock(prisma.category.create).mockResolvedValue({ id: 'cat_1' });

      await request(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: 'A' });

      const call = mock(prisma.$executeRaw).mock.calls[0];
      // tagged template: [strings, ...values]
      expect(call.slice(1)).toContain('category-name:biz_1');
    });

    it('dos altas simultaneas con el mismo nombre: la segunda ve a la primera y recibe 409', async () => {
      // Simula el lock serializando las transacciones: la 2da corre despues de que la 1ra creo.
      let chain: Promise<unknown> = Promise.resolve();
      mock(prisma.$transaction).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
        const run = chain.then(() => fn(prisma));
        chain = run.catch(() => undefined);
        return run;
      });
      const created: string[] = [];
      mock(prisma.category.findFirst).mockImplementation(async () => (created.length ? { id: 'cat_1' } : null));
      mock(prisma.category.create).mockImplementation(async ({ data }: { data: { name: string } }) => {
        await new Promise((r) => setTimeout(r, 10));
        created.push(data.name);
        return { id: 'cat_1', name: data.name };
      });

      const [a, b] = await Promise.all([
        request(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Cortes' }),
        request(app).post('/api/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Cortes' }),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(created).toHaveLength(1);
    });

    it('PUT con nombre toma el lock antes del chequeo y del update', async () => {
      const order: string[] = [];
      mock(prisma.$executeRaw).mockImplementation(async () => { order.push('lock'); });
      mock(prisma.category.findFirst).mockImplementation(async () => { order.push('check'); return null; });
      mock(prisma.category.update).mockImplementation(async () => { order.push('update'); return { id: 'cat_1' }; });

      const res = await request(app)
        .put('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(order).toEqual(['lock', 'check', 'update']);
    });

    it('PUT sin cambiar el nombre (solo icono/orden) no toma el lock', async () => {
      mock(prisma.category.update).mockResolvedValue({ id: 'cat_1' });

      const res = await request(app)
        .put('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sortOrder: 3 });

      expect(res.status).toBe(200);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('DELETE: productos/servicios dados de baja no bloquean', () => {
    it('cuenta solo productos/servicios vigentes (deletedAt null) para el 409', async () => {
      mock(prisma.category.findFirst).mockResolvedValue({ id: 'cat_1', _count: { services: 0, products: 0 } });
      mock(prisma.$transaction).mockResolvedValue([]);

      const res = await request(app).delete('/api/categories/cat_1').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(prisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            _count: { select: { services: { where: { deletedAt: null } }, products: { where: { deletedAt: null } } } },
          },
        })
      );
    });
  });

  describe('DELETE /api/categories/:id', () => {
    it('devuelve 404 si la categoria no es del negocio', async () => {
      mock(prisma.category.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/categories/cat_ajena')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(prisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cat_ajena', businessId: 'biz_1' } })
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('elimina una categoria vacia (204) con scope por negocio', async () => {
      mock(prisma.category.findFirst).mockResolvedValue({ id: 'cat_1', _count: { services: 0, products: 0 } });
      mock(prisma.$transaction).mockResolvedValue([]);

      const res = await request(app)
        .delete('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(prisma.category.deleteMany).toHaveBeenCalledWith({ where: { id: 'cat_1', businessId: 'biz_1' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('devuelve 409 con los conteos y no borra nada si tiene productos/servicios', async () => {
      mock(prisma.category.findFirst).mockResolvedValue({ id: 'cat_1', _count: { services: 2, products: 3 } });

      const res = await request(app)
        .delete('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CATEGORY_IN_USE', products: 3, services: 2 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.category.deleteMany).not.toHaveBeenCalled();
    });

    it('con ?detach=true deja los items sin categoria y borra, todo en una transaccion', async () => {
      mock(prisma.category.findFirst).mockResolvedValue({ id: 'cat_1', _count: { services: 2, products: 3 } });
      mock(prisma.$transaction).mockResolvedValue([]);

      const res = await request(app)
        .delete('/api/categories/cat_1?detach=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'cat_1', businessId: 'biz_1' },
        data: { categoryId: null },
      });
      expect(prisma.service.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'cat_1', businessId: 'biz_1' },
        data: { categoryId: null },
      });
      expect(prisma.category.deleteMany).toHaveBeenCalledWith({ where: { id: 'cat_1', businessId: 'biz_1' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('devuelve 403 para rol no ADMIN', async () => {
      const res = await request(app)
        .delete('/api/categories/cat_1')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(prisma.category.deleteMany).not.toHaveBeenCalled();
    });
  });
});
