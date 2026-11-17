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
    const [bookingsCall, revenueCall] = mock(prisma.$queryRaw).mock.calls as unknown[][];
    // Reservas: Booking.date es medianoche UTC del día calendario -> límites 00:00Z.
    expect(bookingsCall.slice(1)).toContain('biz_1');
    expect(bookingsCall.slice(1)).toContainEqual(new Date('2026-10-20T00:00:00.000Z'));
    expect(bookingsCall.slice(1)).toContainEqual(new Date('2026-10-23T00:00:00.000Z'));
    // Ingresos: createdAt es un instante -> el día argentino sigue arrancando 03:00Z.
    expect(revenueCall.slice(1)).toContain('biz_1');
    expect(revenueCall.slice(1)).toContainEqual(new Date('2026-10-20T03:00:00.000Z'));
    expect(revenueCall.slice(1)).toContainEqual(new Date('2026-10-23T03:00:00.000Z'));
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
    // Booking.date = medianoche UTC del día calendario (no 03:00Z de Argentina).
    expect(arg.where.date.gte.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(arg.where.date.lt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  describe('ventana de Booking.date (medianoche UTC del dia calendario)', () => {
    it('/overview: la ventana y la anterior de reservas usan limites 00:00Z, y las transacciones siguen en 03:00Z', async () => {
      await request(app).get('/api/stats/overview?from=2026-10-10&to=2026-10-19');

      const bookingWheres = mock(prisma.booking.count).mock.calls.map(([a]) => a.where.date);
      const cur = bookingWheres.find((d: { gte: Date }) => d?.gte?.toISOString() === '2026-10-10T00:00:00.000Z');
      // dia `from` incluido (gte 00:00Z del 10) y el dia siguiente a `to` excluido (lt 00:00Z del 20)
      expect(cur.lt.toISOString()).toBe('2026-10-20T00:00:00.000Z');
      const prev = bookingWheres.find((d: { gte: Date }) => d?.gte?.toISOString() === '2026-09-30T00:00:00.000Z');
      expect(prev.lt.toISOString()).toBe('2026-10-10T00:00:00.000Z');
      // lo que corta por createdAt (transacciones) no cambia
      const txWins = mock(prisma.transaction.aggregate).mock.calls.map(([a]) => a.where.createdAt.gte.toISOString());
      expect(txWins).toContain('2026-10-10T03:00:00.000Z');
    });

    it('una reserva del dia `from` (medianoche UTC) cae dentro de la ventana y la del dia siguiente a `to` queda fuera', async () => {
      await request(app).get('/api/stats/top-services?from=2026-10-16&to=2026-10-16');

      const where = mock(prisma.booking.groupBy).mock.calls.at(-1)![0].where.date as { gte: Date; lt: Date };
      const fromDay = new Date('2026-10-16T00:00:00.000Z'); // Booking.date del dia `from`
      const nextDay = new Date('2026-10-17T00:00:00.000Z'); // Booking.date del dia siguiente a `to`
      expect(fromDay >= where.gte && fromDay < where.lt).toBe(true);
      expect(nextDay >= where.gte && nextDay < where.lt).toBe(false);
    });

    it('/weekly: la serie por dia agrupa por la fecha de Booking.date sin convertir de zona', async () => {
      mock(prisma.$queryRaw)
        .mockResolvedValueOnce([{ day: '2026-10-20', n: 2 }])
        .mockResolvedValueOnce([]);

      const res = await request(app).get('/api/stats/weekly?from=2026-10-20&to=2026-10-21');

      // la reserva de medianoche UTC del 20/10 va al balde del 20/10 (antes caia en el 19)
      expect(res.body[0]).toMatchObject({ date: '2026-10-20', bookings: 2 });
      expect(res.body[1]).toMatchObject({ date: '2026-10-21', bookings: 0 });
      const strings = (mock(prisma.$queryRaw).mock.calls[0][0] as string[]).join(' ');
      expect(strings).toContain(`to_char("date", 'YYYY-MM-DD')`);
      expect(strings).not.toContain('AT TIME ZONE');
      // la consulta de ingresos (createdAt) conserva la conversion a hora de Argentina
      const revenueSql = (mock(prisma.$queryRaw).mock.calls[1][0] as string[]).join(' ');
      expect(revenueSql).toContain('AT TIME ZONE');
    });
  });
});
