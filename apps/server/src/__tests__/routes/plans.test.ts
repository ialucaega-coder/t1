/**
 * Pruebas de integracion para las rutas de planes
 * (`src/routes/plans.ts`): catalogo PUBLICO de planes.
 *
 * Es un catalogo GLOBAL (sin businessId, sin auth): expone unicamente los
 * planes activos ordenados por precio mensual. Se mockea Prisma para aislar
 * la logica de la ruta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    plan: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';
import { plansRouter } from '../../routes/plans';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/plans', plansRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/plans', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/plans/public', () => {
    it('devuelve el catalogo global de planes activos ordenados por precio mensual', async () => {
      mock(prisma.plan.findMany).mockResolvedValue([
        { id: 'plan_free', name: 'Free', tier: 'FREE', priceMonthly: 0 },
        { id: 'plan_pro', name: 'Pro', tier: 'PRO', priceMonthly: 5000 },
      ]);

      const res = await request(app).get('/api/plans/public');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ id: 'plan_free', tier: 'FREE' });
      // Catalogo global: solo planes activos, ordenados por priceMonthly asc.
      expect(prisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: { priceMonthly: 'asc' },
        })
      );
    });

    it('es un catalogo GLOBAL: el where NO filtra por businessId', async () => {
      mock(prisma.plan.findMany).mockResolvedValue([]);

      await request(app).get('/api/plans/public');

      const call = mock(prisma.plan.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('businessId');
    });

    it('no requiere autenticacion (endpoint publico)', async () => {
      mock(prisma.plan.findMany).mockResolvedValue([]);

      // Sin header Authorization: igual responde 200.
      const res = await request(app).get('/api/plans/public');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('devuelve 500 si Prisma falla', async () => {
      mock(prisma.plan.findMany).mockRejectedValue(new Error('db error'));

      const res = await request(app).get('/api/plans/public');

      expect(res.status).toBe(500);
    });
  });
});
