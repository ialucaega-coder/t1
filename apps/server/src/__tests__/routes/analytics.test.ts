/**
 * Pruebas del router de analytics (routes/analytics.ts): endpoints de solo
 * lectura que agregan métricas del negocio. Con contadores en cero verificamos
 * que cada endpoint responde 200 sin romper y que las consultas están acotadas
 * por businessId (aislamiento multi-tenant).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { count: vi.fn(), findMany: vi.fn() },
    booking: { count: vi.fn() },
    message: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    // getFunnel (reusado por /funnel) usa connection.findFirst + user.findMany.
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/analytics', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear(); // los endpoints cachean la respuesta unos segundos por negocio
    mock(prisma.conversation.count).mockResolvedValue(0);
    mock(prisma.conversation.findMany).mockResolvedValue([]);
    mock(prisma.booking.count).mockResolvedValue(0);
    mock(prisma.message.count).mockResolvedValue(0);
    mock(prisma.message.aggregate).mockResolvedValue({ _avg: { responseTime: null, tokens: null } });
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.user.findMany).mockResolvedValue([]);
    mock(prisma.$queryRaw).mockResolvedValue([{ total: 0n }]);
  });

  const endpoints = ['/kpi', '/conversations', '/satisfaction', '/improvements', '/costs', '/metrics', '/timeseries', '/funnel'];

  for (const ep of endpoints) {
    it(`GET ${ep} responde 200 con métricas en cero`, async () => {
      const res = await request(app).get(`/api/analytics${ep}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeTypeOf('object');
    });
  }

  it('las consultas de /kpi están acotadas por businessId', async () => {
    await request(app).get('/api/analytics/kpi');
    const calls = mock(prisma.conversation.count).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [arg] of calls) {
      expect(arg.where.businessId).toBe('biz_1');
    }
  });

  // Instante fijo: 2026-11-02 01:00 UTC = domingo 1/11 22:00 en Argentina. Un agrupado por
  // el día del servidor (UTC) pondría este instante en el 2/11; el de Argentina, en el 1/11.
  const FIXED_NOW = new Date('2026-11-02T01:00:00.000Z');
  const sqlValues = (call: unknown[]) => call.slice(1);

  describe('series por día (SQL, hora Argentina)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(FIXED_NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('/conversations hace UNA consulta agregada acotada por businessId y devuelve 7 días', async () => {
      mock(prisma.$queryRaw).mockResolvedValue([]);

      const res = await request(app).get('/api/analytics/conversations');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(7);
      expect(mock(prisma.$queryRaw).mock.calls.length).toBe(1);
      // Ya no trae las conversaciones a memoria.
      expect(mock(prisma.conversation.findMany).mock.calls.length).toBe(0);
      const values = sqlValues(mock(prisma.$queryRaw).mock.calls[0]);
      expect(values).toContain('biz_1');
      expect(values).toContain('America/Argentina/Buenos_Aires');
      // Ventana: inicio (00:00 AR = 03:00 UTC) del día más viejo, 26/10.
      expect(values).toContainEqual(new Date('2026-10-26T03:00:00.000Z'));
    });

    it('/conversations asigna cada fila al día de Argentina que devuelve la DB', async () => {
      mock(prisma.$queryRaw).mockResolvedValue([
        { day: '2026-11-01', n: 2 }, // "hoy" en Argentina aunque en UTC ya sea 2/11
        { day: '2026-10-31', n: 1 },
        { day: '2026-01-01', n: 9 }, // fuera de la ventana: se ignora
      ]);

      const res = await request(app).get('/api/analytics/conversations');

      expect(res.body[6].count).toBe(2);
      expect(res.body[5].count).toBe(1);
      const total = res.body.reduce((sum: number, d: { count: number }) => sum + d.count, 0);
      expect(total).toBe(3);
    });

    it('/timeseries: una consulta por tabla (a lo sumo 14 filas c/u), acotadas por businessId', async () => {
      mock(prisma.$queryRaw).mockResolvedValue([]);

      const res = await request(app).get('/api/analytics/timeseries');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(14);
      expect(res.body[0]).toHaveProperty('date');
      expect(res.body[0]).toHaveProperty('label');
      expect(mock(prisma.$queryRaw).mock.calls.length).toBe(2);
      expect(mock(prisma.conversation.findMany).mock.calls.length).toBe(0);
      expect(mock(prisma.message.findMany).mock.calls.length).toBe(0);
      for (const call of mock(prisma.$queryRaw).mock.calls) {
        expect(sqlValues(call)).toContain('biz_1');
        expect(sqlValues(call)).toContainEqual(new Date('2026-10-19T03:00:00.000Z'));
      }
      const dates = res.body.map((d: { date: string }) => d.date);
      expect(dates[0]).toBe('2026-10-19');
      expect(dates[13]).toBe('2026-11-01');
      expect([...dates].sort()).toEqual(dates);
      expect(res.body[13].label).toBe('1/11'); // dd/mm de es-AR (mismas opciones que antes)
    });

    it('/timeseries combina conversaciones y mensajes por día', async () => {
      mock(prisma.$queryRaw)
        .mockResolvedValueOnce([{ day: '2026-11-01', n: 2 }]) // conversaciones
        .mockResolvedValueOnce([
          { day: '2026-11-01', n: 3 },
          { day: '2026-10-30', n: 5 },
        ]); // mensajes

      const res = await request(app).get('/api/analytics/timeseries');

      const last = res.body[13];
      expect(last.conversations).toBe(2);
      expect(last.messages).toBe(3);
      expect(res.body[11].messages).toBe(5);
      const totalMsg = res.body.reduce((s: number, d: { messages: number }) => s + d.messages, 0);
      expect(totalMsg).toBe(8);
    });
  });

  describe('GET /funnel', () => {
    it('reusa getFunnel y calcula la conversión entre etapas', async () => {
      // 10 clientes: 4 NEW (default, sin entrada), 3 HOT, 2 PAYMENT, 1 CUSTOMER.
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { stages: { c5: 'HOT', c6: 'HOT', c7: 'HOT', c8: 'PAYMENT', c9: 'PAYMENT', c10: 'CUSTOMER' } },
      });
      mock(prisma.user.findMany).mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}` }))
      );

      const res = await request(app).get('/api/analytics/funnel');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(10);
      expect(res.body.stages).toHaveLength(4);

      const byStage = Object.fromEntries(
        (res.body.stages as { stage: string; count: number; conversionFromPrev: number | null }[]).map((s) => [s.stage, s])
      );
      expect(byStage.NEW.count).toBe(4);
      expect(byStage.HOT.count).toBe(3);
      expect(byStage.PAYMENT.count).toBe(2);
      expect(byStage.CUSTOMER.count).toBe(1);

      // Primera etapa no tiene anterior.
      expect(byStage.NEW.conversionFromPrev).toBeNull();
      // HOT/NEW = 3/4 = 75%.
      expect(byStage.HOT.conversionFromPrev).toBe(75);
      // PAYMENT/HOT = 2/3 ≈ 66.7%.
      expect(byStage.PAYMENT.conversionFromPrev).toBeCloseTo(66.7, 1);
      // CUSTOMER/PAYMENT = 1/2 = 50%.
      expect(byStage.CUSTOMER.conversionFromPrev).toBe(50);
      // Consulta de clientes acotada por businessId.
      const [userArg] = mock(prisma.user.findMany).mock.calls[0];
      expect(userArg.where.businessId).toBe('biz_1');
    });

    it('devuelve total 0 y conversiones en cero sin contactos', async () => {
      mock(prisma.user.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/analytics/funnel');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      const stages = res.body.stages as { count: number; pctOfTotal: number }[];
      expect(stages.every((s) => s.count === 0 && s.pctOfTotal === 0)).toBe(true);
    });
  });

  it('requiere autenticación (el router monta requireAuth)', async () => {
    // Con el mock de auth siempre autentica; validamos que el endpoint existe y
    // responde (no 404), asegurando el wiring del router.
    const res = await request(app).get('/api/analytics/kpi');
    expect(res.status).not.toBe(404);
  });

  describe('GET /attribution (embudo por origen CTWA)', () => {
    // El endpoint hace 3 consultas agregadas en paralelo, en este orden: totales,
    // por origen y top de anuncios. La lectura tolerante del JSON vive en el SQL
    // (attributionBase); acá se verifica el mapeo de la respuesta y el scope.
    const mockAgg = (
      totals: { total: number; attributed: number },
      sources: { source: string; n: number }[],
      ads: { source_id: string | null; headline: string | null; n: number }[],
    ) =>
      mock(prisma.$queryRaw)
        .mockResolvedValueOnce([totals])
        .mockResolvedValueOnce(sources)
        .mockResolvedValueOnce(ads);

    it('sin conversaciones atribuidas devuelve attributed:0, bySource:[] y byAd:[]', async () => {
      mockAgg({ total: 4, attributed: 0 }, [], []);

      const res = await request(app).get('/api/analytics/attribution');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 4, attributed: 0, bySource: [], byAd: [] });
    });

    it('mapea origen y top de anuncios (sin headline si no hay; sourceId vacío si solo hay titular)', async () => {
      mockAgg(
        { total: 7, attributed: 6 },
        [{ source: 'ctwa', n: 6 }],
        [
          { source_id: 'ad_1', headline: 'Promo verano', n: 3 },
          { source_id: 'ad_2', headline: 'Descuento otoño', n: 2 },
          { source_id: 'ad_3', headline: null, n: 1 },
          { source_id: null, headline: 'Solo titular', n: 1 },
        ],
      );

      const res = await request(app).get('/api/analytics/attribution');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      expect(res.body.attributed).toBe(6);
      expect(res.body.bySource).toEqual([{ source: 'ctwa', count: 6 }]);
      expect(res.body.byAd).toEqual([
        { sourceId: 'ad_1', headline: 'Promo verano', count: 3 },
        { sourceId: 'ad_2', headline: 'Descuento otoño', count: 2 },
        { sourceId: 'ad_3', count: 1 },
        { sourceId: '', headline: 'Solo titular', count: 1 },
      ]);
      expect(typeof res.body.total).toBe('number');
    });

    it('las tres consultas están acotadas por businessId y ya no traen metadata a memoria', async () => {
      mockAgg({ total: 0, attributed: 0 }, [], []);
      await request(app).get('/api/analytics/attribution');
      expect(mock(prisma.$queryRaw).mock.calls.length).toBe(3);
      expect(mock(prisma.conversation.findMany).mock.calls.length).toBe(0);
      for (const call of mock(prisma.$queryRaw).mock.calls) {
        // El businessId viaja dentro del fragmento SQL anidado (attributionBase).
        expect(JSON.stringify(sqlValues(call))).toContain('biz_1');
      }
    });
  });

  it('GET /attribution responde 401 sin token (requireAuth real)', async () => {
    // El resto del archivo mockea requireAuth; acá montamos el middleware REAL
    // como gate del router (igual que en index.ts) para verificar el 401.
    const actualAuth = await vi.importActual<typeof import('../../middleware/auth')>('../../middleware/auth');
    const realApp = express();
    realApp.use(express.json());
    realApp.use('/api/analytics', actualAuth.requireAuth, analyticsRouter);
    realApp.use(errorHandler);

    const res = await request(realApp).get('/api/analytics/attribution');
    expect(res.status).toBe(401);
  });
});
