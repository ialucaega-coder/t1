/**
 * Rango de fechas en analytics (?days | ?from&to): ventana en hora de Argentina,
 * tope de días, valor por defecto intacto y aislamiento por businessId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { count: vi.fn(), findMany: vi.fn() },
    booking: { count: vi.fn() },
    message: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    connection: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { prisma } from '../../lib/prisma';
import { analyticsRouter } from '../../routes/analytics';
import { cache } from '../../lib/cache';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const sqlValues = (call: unknown[]) => call.slice(1);

// 2026-11-02 01:00 UTC = domingo 1/11 22:00 en Argentina.
const FIXED_NOW = new Date('2026-11-02T01:00:00.000Z');

type Win = { createdAt: { gte: Date; lt?: Date } };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/analytics — rango de fechas', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    mock(prisma.conversation.count).mockResolvedValue(0);
    mock(prisma.booking.count).mockResolvedValue(0);
    mock(prisma.message.count).mockResolvedValue(0);
    mock(prisma.message.aggregate).mockResolvedValue({ _avg: { responseTime: null } });
    mock(prisma.$queryRaw).mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('rango inválido (to sin from, from > to, > 366 días, days+from) responde 400 sin consultar la DB', async () => {
    for (const q of ['to=2026-10-31', 'from=2026-10-31&to=2026-10-01', 'from=2024-01-01&to=2026-01-01', 'days=400', 'days=7&from=2026-10-01']) {
      const res = await request(app).get(`/api/analytics/timeseries?${q}`);
      expect(res.status).toBe(400);
    }
    expect(mock(prisma.$queryRaw).mock.calls.length).toBe(0);
  });

  it('/timeseries con from/to devuelve un punto por día pedido y acota la ventana [from, to+1)', async () => {
    const res = await request(app).get('/api/analytics/timeseries?from=2026-10-20&to=2026-10-24');

    expect(res.status).toBe(200);
    expect(res.body.map((p: { date: string }) => p.date)).toEqual([
      '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
    ]);
    expect(mock(prisma.$queryRaw).mock.calls.length).toBe(2);
    for (const call of mock(prisma.$queryRaw).mock.calls) {
      const values = sqlValues(call);
      expect(values).toContain('biz_1');
      expect(values).toContainEqual(new Date('2026-10-20T03:00:00.000Z')); // inicio (00:00 AR)
      // Fin exclusivo (00:00 AR del día siguiente): viaja dentro del fragmento SQL anidado.
      expect(JSON.stringify(values)).toContain('2026-10-25T03:00:00.000Z');
    }
  });

  it('/timeseries sin parámetros conserva los 14 días y no pone tope superior', async () => {
    const res = await request(app).get('/api/analytics/timeseries');

    expect(res.body).toHaveLength(14);
    for (const call of mock(prisma.$queryRaw).mock.calls) {
      const dates = sqlValues(call).filter((v) => v instanceof Date);
      expect(dates).toHaveLength(1);
    }
  });

  it('/conversations?days=30 devuelve 30 días terminando hoy (hora Argentina) con etiqueta dd/mm', async () => {
    const res = await request(app).get('/api/analytics/conversations?days=30');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(30);
    expect(res.body[29].date).toBe('2026-11-01');
    expect(res.body[29].day).toBe('1/11');
    expect(res.body[0].date).toBe('2026-10-03');
  });

  it('/conversations sin rango sigue devolviendo 7 días con día de la semana', async () => {
    const res = await request(app).get('/api/analytics/conversations');

    expect(res.body).toHaveLength(7);
    expect(res.body[6].day).toBe('dom');
  });

  it('/kpi con rango consulta la ventana pedida y la anterior de igual largo, por businessId', async () => {
    const res = await request(app).get('/api/analytics/kpi?from=2026-10-10&to=2026-10-19'); // 10 días

    expect(res.status).toBe(200);
    expect(res.body.range).toEqual({ from: '2026-10-10', to: '2026-10-19', days: 10, custom: true });
    const wheres = mock(prisma.conversation.count).mock.calls.map(([a]) => a.where);
    for (const w of wheres) expect(w.businessId).toBe('biz_1');
    const current = wheres.find((w: Win) => w.createdAt.gte.toISOString() === '2026-10-10T03:00:00.000Z');
    expect(current.createdAt.lt.toISOString()).toBe('2026-10-20T03:00:00.000Z');
    const prev = wheres.find((w: Win) => w.createdAt.gte.toISOString() === '2026-09-30T03:00:00.000Z');
    expect(prev.createdAt.lt.toISOString()).toBe('2026-10-10T03:00:00.000Z');
  });

  it('/kpi sin rango mantiene la ventana móvil de 30 días y el presupuesto fijo', async () => {
    const res = await request(app).get('/api/analytics/kpi');

    expect(res.body.monthlyBudget).toBe(50);
    expect(res.body.range.custom).toBe(false);
    const gtes = mock(prisma.conversation.count).mock.calls.map(([a]) => a.where.createdAt.gte.toISOString());
    expect(gtes).toContain('2026-10-03T01:00:00.000Z'); // ahora - 30 días
    expect(mock(prisma.conversation.count).mock.calls[0][0].where.createdAt.lt).toBeUndefined();
  });

  it('la caché es por URL: rangos distintos dan resultados distintos', async () => {
    mock(prisma.conversation.count).mockResolvedValue(5);
    const a = await request(app).get('/api/analytics/kpi?days=7');
    mock(prisma.conversation.count).mockResolvedValue(9);
    const b = await request(app).get('/api/analytics/kpi?days=30');

    expect(a.body.totalConversations).toBe(5);
    expect(b.body.totalConversations).toBe(9);
  });

  describe('satisfacción estimada', () => {
    it('/satisfaction marca cada ítem como estimado (basis: estado_de_conversaciones) sin cambiar los demás campos', async () => {
      mock(prisma.conversation.count).mockImplementation(async ({ where }: { where: { status?: string } }) =>
        where.status === 'CLOSED' ? 10 : where.status === 'OPEN' ? 5 : 5,
      );

      const res = await request(app).get('/api/analytics/satisfaction');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(5);
      for (const item of res.body) {
        expect(item.estimated).toBe(true);
        expect(item.basis).toBe('estado_de_conversaciones');
      }
      // Los campos de siempre siguen igual: 5★ = cerradas, 4★ = 60% de las abiertas.
      expect(res.body[0]).toMatchObject({ stars: 5, count: 10, color: '#22c55e' });
      expect(res.body[1]).toMatchObject({ stars: 4, count: 3 });
    });

    it('/satisfaction sin conversaciones también viene marcado como estimado', async () => {
      const res = await request(app).get('/api/analytics/satisfaction');

      expect(res.body.every((i: { estimated: boolean; count: number }) => i.estimated === true && i.count === 0)).toBe(true);
    });

    it('/kpi declara que la satisfacción es estimada', async () => {
      const res = await request(app).get('/api/analytics/kpi');

      expect(res.body.estimated).toBe(true);
      expect(res.body.basis).toBe('estado_de_conversaciones');
      expect(res.body.avgSatisfaction).toBeTypeOf('number');
    });
  });
});
