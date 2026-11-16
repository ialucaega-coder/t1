/**
 * Rango de fechas en /api/stats (?days | ?from&to) para overview, weekly y
 * top-services: ventana en hora de Argentina, tope de días, default intacto
 * y scope por businessId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    $queryRaw: vi.fn(),
  },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
}));
vi.mock('../../lib/cache', () => ({
  cache: { get: vi.fn(() => undefined), set: vi.fn() },
  cacheKey: (...parts: (string | number)[]) => parts.join(':'),
}));

import { prisma } from '../../lib/prisma';
import { statsRouter } from '../../routes/stats';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

// 2026-11-02 01:00 UTC = domingo 1/11 22:00 en Argentina.
const FIXED_NOW = new Date('2026-11-02T01:00:00.000Z');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stats', statsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/stats — rango de fechas', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    mock(prisma.booking.count).mockResolvedValue(0);
    mock(prisma.booking.groupBy).mockResolvedValue([]);
    mock(prisma.user.count).mockResolvedValue(0);
    mock(prisma.service.count).mockResolvedValue(0);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.count).mockResolvedValue(0);
    mock(prisma.transaction.aggregate).mockResolvedValue({ _sum: { amount: 0 } });
    mock(prisma.$queryRaw).mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('rango inválido responde 400 en overview, weekly y top-services sin tocar la DB', async () => {
    for (const ep of ['overview', 'weekly', 'top-services']) {
      for (const q of ['days=1000', 'from=2026-10-31&to=2026-10-01', 'to=2026-10-31']) {
        const res = await request(app).get(`/api/stats/${ep}?${q}`);
        expect(res.status).toBe(400);
      }
    }
    expect(prisma.booking.count).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('/weekly con rango: una consulta SQL por tabla, un punto por día pedido y valores por día', async () => {
    mock(prisma.$queryRaw)
      .mockResolvedValueOnce([{ day: '2026-10-21', n: 3 }]) // reservas
      .mockResolvedValueOnce([{ day: '2026-10-21', total: '1500.50' }]); // ingresos

    const res = await request(app).get('/api/stats/weekly?from=2026-10-20&to=2026-10-22');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[1]).toMatchObject({ date: '2026-10-21', bookings: 3, revenue: 1500.5 });
    expect(res.body[0]).toMatchObject({ bookings: 0, revenue: 0 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const call of mock(prisma.$queryRaw).mock.calls) {
      const values = (call as unknown[]).slice(1);
      expect(values).toContain('biz_1');
      expect(values).toContainEqual(new Date('2026-10-20T03:00:00.000Z'));
      expect(values).toContainEqual(new Date('2026-10-23T03:00:00.000Z'));
    }
    // Sin el camino viejo de N consultas por día.
    expect(prisma.booking.count).not.toHaveBeenCalled();
  });

  it('/weekly?days=30 usa etiquetas dd/mm (el día de la semana se repetiría)', async () => {
    const res = await request(app).get('/api/stats/weekly?days=30');

    expect(res.body).toHaveLength(30);
    expect(res.body[29]).toMatchObject({ date: '2026-11-01', day: '1/11' });
  });

  it('/weekly sin rango mantiene los 7 días del camino histórico', async () => {
    const res = await request(app).get('/api/stats/weekly');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.booking.count).toHaveBeenCalled();
  });

  it('/overview con rango cuenta la ventana pedida y la anterior de igual largo, por businessId', async () => {
    const res = await request(app).get('/api/stats/overview?from=2026-10-10&to=2026-10-19');

    expect(res.status).toBe(200);
    expect(res.body.range).toEqual({ from: '2026-10-10', to: '2026-10-19', days: 10, custom: true });
    const wins = mock(prisma.transaction.aggregate).mock.calls.map(([a]) => a.where);
    for (const w of wins) expect(w.businessId).toBe('biz_1');
    const cur = wins.find((w: { createdAt: { gte: Date } }) => w.createdAt.gte.toISOString() === '2026-10-10T03:00:00.000Z');
    expect(cur.createdAt.lt.toISOString()).toBe('2026-10-20T03:00:00.000Z');
    const prev = wins.find((w: { createdAt: { gte: Date } }) => w.createdAt.gte.toISOString() === '2026-09-30T03:00:00.000Z');
    expect(prev.createdAt.lt.toISOString()).toBe('2026-10-10T03:00:00.000Z');
  });

  it('/top-services con rango filtra reservas por la ventana pedida y por businessId', async () => {
    await request(app).get('/api/stats/top-services?days=7');

    const arg = mock(prisma.booking.groupBy).mock.calls[0][0];
    expect(arg.where.businessId).toBe('biz_1');
    expect(arg.where.date.gte.toISOString()).toBe('2026-10-26T03:00:00.000Z');
    expect(arg.where.date.lt.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });
});
