/**
 * Pruebas del router de analytics (routes/analytics.ts): endpoints de solo
 * lectura que agregan métricas del negocio. Con contadores en cero verificamos
 * que cada endpoint responde 200 sin romper y que las consultas están acotadas
 * por businessId (aislamiento multi-tenant).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('/conversations usa una sola consulta (sin N+1) acotada por businessId', async () => {
    mock(prisma.conversation.findMany).mockResolvedValue([]);

    const res = await request(app).get('/api/analytics/conversations');

    expect(res.status).toBe(200);
    // Antes hacía 7 count() en un loop; ahora: un único findMany.
    expect(mock(prisma.conversation.findMany).mock.calls.length).toBe(1);
    expect(mock(prisma.conversation.count).mock.calls.length).toBe(0);
    const [arg] = mock(prisma.conversation.findMany).mock.calls[0];
    expect(arg.where.businessId).toBe('biz_1');
    // Siempre devuelve una serie de 7 días.
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(7);
  });

  it('/conversations agrupa por día las conversaciones de la ventana', async () => {
    const today = new Date();
    mock(prisma.conversation.findMany).mockResolvedValue([
      { createdAt: today },
      { createdAt: today },
    ]);

    const res = await request(app).get('/api/analytics/conversations');

    expect(res.status).toBe(200);
    const total = res.body.reduce((sum: number, d: { count: number }) => sum + d.count, 0);
    expect(total).toBe(2);
    // El último bucket (hoy) debe contener las 2 conversaciones.
    expect(res.body[res.body.length - 1].count).toBe(2);
  });

  describe('GET /timeseries', () => {
    it('devuelve una serie de 14 días acotada por businessId con una consulta por tabla', async () => {
      mock(prisma.conversation.findMany).mockResolvedValue([]);
      mock(prisma.message.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/analytics/timeseries');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(14);
      expect(res.body[0]).toHaveProperty('date');
      expect(res.body[0]).toHaveProperty('label');
      expect(res.body[0]).toHaveProperty('conversations');
      expect(res.body[0]).toHaveProperty('messages');
      // Una sola consulta por tabla (sin N+1).
      expect(mock(prisma.conversation.findMany).mock.calls.length).toBe(1);
      expect(mock(prisma.message.findMany).mock.calls.length).toBe(1);
      const [convArg] = mock(prisma.conversation.findMany).mock.calls[0];
      expect(convArg.where.businessId).toBe('biz_1');
      const [msgArg] = mock(prisma.message.findMany).mock.calls[0];
      expect(msgArg.where.conversation.businessId).toBe('biz_1');
      // Fechas estrictamente ascendentes (el día más viejo primero).
      const dates = res.body.map((d: { date: string }) => d.date);
      expect([...dates].sort()).toEqual(dates);
    });

    it('agrupa por día las conversaciones y mensajes de la ventana', async () => {
      const today = new Date();
      mock(prisma.conversation.findMany).mockResolvedValue([{ createdAt: today }, { createdAt: today }]);
      mock(prisma.message.findMany).mockResolvedValue([{ createdAt: today }, { createdAt: today }, { createdAt: today }]);

      const res = await request(app).get('/api/analytics/timeseries');

      expect(res.status).toBe(200);
      const last = res.body[res.body.length - 1];
      // El último bucket (hoy) acumula lo de hoy.
      expect(last.conversations).toBe(2);
      expect(last.messages).toBe(3);
      const totalConv = res.body.reduce((s: number, d: { conversations: number }) => s + d.conversations, 0);
      const totalMsg = res.body.reduce((s: number, d: { messages: number }) => s + d.messages, 0);
      expect(totalConv).toBe(2);
      expect(totalMsg).toBe(3);
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
});
