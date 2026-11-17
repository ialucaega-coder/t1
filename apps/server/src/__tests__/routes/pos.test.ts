/**
 * Pruebas de integracion para las rutas de punto de venta (`src/routes/pos.ts`):
 * listado combinado de servicios (activos) y productos (con stock) como items
 * vendibles.
 *
 * Se mockea Prisma y se usa el middleware de auth real con JWT firmado para
 * probar 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    service: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { posRouter } from '../../routes/pos';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pos', posRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/pos', () => {
  const app = buildApp();
  const token = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/pos/items', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/pos/items');
      expect(res.status).toBe(401);
    });

    it('combina servicios y productos como items con precio numerico', async () => {
      mock(prisma.service.findMany).mockResolvedValue([{ name: 'Corte', price: 1500 }]);
      mock(prisma.product.findMany).mockResolvedValue([{ name: 'Shampoo', price: 800 }]);

      const res = await request(app).get('/api/pos/items').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { name: 'Corte', price: 1500 },
        { name: 'Shampoo', price: 800 },
      ]);
      // Filtra por negocio y por disponibilidad (servicios activos, productos con stock)
      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', isActive: true } })
      );
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', stock: { gt: 0 } } })
      );
    });

    it('convierte precios tipo Decimal (string) a Number', async () => {
      // Prisma puede devolver Decimal serializado; la ruta hace Number(price).
      mock(prisma.service.findMany).mockResolvedValue([{ name: 'Manicura', price: '2000.5' }]);
      mock(prisma.product.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/pos/items').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ name: 'Manicura', price: 2000.5 }]);
    });

    it('devuelve lista vacia cuando no hay items', async () => {
      mock(prisma.service.findMany).mockResolvedValue([]);
      mock(prisma.product.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/pos/items').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('devuelve 500 si Prisma falla', async () => {
      mock(prisma.service.findMany).mockRejectedValue(new Error('db error'));
      mock(prisma.product.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/pos/items').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
    });
  });
});
