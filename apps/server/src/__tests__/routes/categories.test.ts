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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
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
        expect.objectContaining({ where: { businessId: 'biz_1' }, orderBy: { sortOrder: 'asc' } })
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

  describe('DELETE /api/categories/:id', () => {
    it('elimina una categoria existente', async () => {
      mock(prisma.category.delete).mockResolvedValue({});

      const res = await request(app)
        .delete('/api/categories/cat_1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(prisma.category.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cat_1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 403 para rol no ADMIN', async () => {
      const res = await request(app)
        .delete('/api/categories/cat_1')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });
  });
});
