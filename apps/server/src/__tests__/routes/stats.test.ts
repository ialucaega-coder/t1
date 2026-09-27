/**
 * Pruebas de integracion para las rutas de estadisticas
 * (`src/routes/stats.ts`): endpoints de SOLO LECTURA con agregaciones para el
 * dashboard (overview, weekly, top-services, dashboard, health).
 *
 * Todos los endpoints estan scopeados por `businessId` (multi-tenant). Se mockea
 * Prisma, el middleware de auth y la cache en memoria (para que cada test sea un
 * "miss" y siempre pegue a Prisma, sin arrastrar valores cacheados del test previo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    booking: { count: vi.fn(), groupBy: vi.fn() },
    user: { count: vi.fn() },
    transaction: { aggregate: vi.fn() },
    service: { count: vi.fn(), findMany: vi.fn() },
    product: { count: vi.fn() },
    conversation: { count: vi.fn() },
    message: { count: vi.fn() },
    bot: { count: vi.fn() },
    subscription: { findUnique: vi.fn() },
    notification: { findMany: vi.fn() },
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

// Cache siempre en "miss": get() -> undefined; set() -> no-op.
vi.mock('../../lib/cache', () => ({
  cache: { get: vi.fn(() => undefined), set: vi.fn() },
  cacheKey: (...parts: (string | number)[]) => parts.join(':'),
}));

import { prisma } from '../../lib/prisma';
import { statsRouter } from '../../routes/stats';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stats', statsRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/stats', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults razonables para que las agregaciones no exploten.
    mock(prisma.booking.count).mockResolvedValue(0);
    mock(prisma.user.count).mockResolvedValue(0);
    mock(prisma.service.count).mockResolvedValue(0);
    mock(prisma.product.count).mockResolvedValue(0);
    mock(prisma.conversation.count).mockResolvedValue(0);
    mock(prisma.message.count).mockResolvedValue(0);
    mock(prisma.bot.count).mockResolvedValue(0);
    mock(prisma.transaction.aggregate).mockResolvedValue({ _sum: { amount: 0 } });
    mock(prisma.subscription.findUnique).mockResolvedValue(null);
    mock(prisma.notification.findMany).mockResolvedValue([]);
    mock(prisma.booking.groupBy).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
  });

  describe('GET /api/stats/overview', () => {
    it('devuelve las metricas del negocio scopeadas por businessId', async () => {
      mock(prisma.booking.count).mockResolvedValue(4);
      mock(prisma.user.count).mockResolvedValue(10);
      mock(prisma.transaction.aggregate).mockResolvedValue({ _sum: { amount: 5000 } });
      mock(prisma.service.count).mockResolvedValue(3);
      mock(prisma.product.count).mockResolvedValue(7);

      const res = await request(app).get('/api/stats/overview');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        todayBookings: 4,
        monthBookings: 4,
        totalClients: 10,
        revenue: 5000,
        activeServices: 3,
        totalProducts: 7,
      });
      // Todos los conteos filtran por el negocio del token.
      expect(prisma.booking.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
      expect(prisma.transaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });

    it('devuelve 500 si Prisma falla', async () => {
      mock(prisma.booking.count).mockRejectedValue(new Error('db error'));

      const res = await request(app).get('/api/stats/overview');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/stats/weekly', () => {
    it('devuelve una serie de 7 dias con reservas y facturacion', async () => {
      mock(prisma.booking.count).mockResolvedValue(2);
      mock(prisma.transaction.aggregate).mockResolvedValue({ _sum: { amount: 1200 } });

      const res = await request(app).get('/api/stats/weekly');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(7);
      expect(res.body[0]).toMatchObject({ bookings: 2, revenue: 1200 });
      expect(res.body[0]).toHaveProperty('date');
      expect(res.body[0]).toHaveProperty('day');
      expect(prisma.booking.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });
  });

  describe('GET /api/stats/top-services', () => {
    it('cruza el groupBy de reservas con el detalle del servicio', async () => {
      mock(prisma.booking.groupBy).mockResolvedValue([
        { serviceId: 'svc_1', _count: { id: 9 } },
        { serviceId: 'svc_2', _count: { id: 4 } },
      ]);
      mock(prisma.service.findMany).mockResolvedValue([
        { id: 'svc_1', name: 'Corte' },
        { id: 'svc_2', name: 'Color' },
      ]);

      const res = await request(app).get('/api/stats/top-services');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 'svc_1', name: 'Corte', bookingCount: 9 },
        { id: 'svc_2', name: 'Color', bookingCount: 4 },
      ]);
      expect(prisma.booking.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });
  });

  describe('GET /api/stats/dashboard', () => {
    it('agrega conversaciones, bots y actividad reciente (sin suscripcion)', async () => {
      mock(prisma.conversation.count).mockResolvedValue(5);
      mock(prisma.message.count).mockResolvedValue(20);
      mock(prisma.bot.count).mockResolvedValue(2);
      mock(prisma.notification.findMany).mockResolvedValue([{ id: 'n1', title: 'Hola' }]);

      const res = await request(app).get('/api/stats/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.conversations).toMatchObject({ open: 5, total: 5, handoff: 5 });
      expect(res.body.bots).toMatchObject({ active: 2, total: 2 });
      expect(res.body.subscription).toBeNull();
      expect(res.body.recentActivity).toHaveLength(1);
      expect(prisma.conversation.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });

    it('mapea la suscripcion (con plan) cuando existe', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue({
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-12-31'),
        plan: { name: 'Pro', tier: 'PRO', maxBots: 5, maxMessages: 1000, maxContacts: 500 },
      });

      const res = await request(app).get('/api/stats/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.subscription).toMatchObject({
        planName: 'Pro',
        planTier: 'PRO',
        status: 'ACTIVE',
        maxBots: 5,
      });
    });
  });

  describe('GET /api/stats/health', () => {
    it('devuelve los indicadores de salud del negocio', async () => {
      mock(prisma.booking.count).mockResolvedValue(10);
      mock(prisma.user.count).mockResolvedValue(5);

      const res = await request(app).get('/api/stats/health');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.indicators)).toBe(true);
      expect(res.body.indicators).toHaveLength(5);
      const keys = (res.body.indicators as { key: string }[]).map((i) => i.key);
      expect(keys).toContain('confirmation_rate');
      expect(keys).toContain('retention_rate');
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });
  });
});
