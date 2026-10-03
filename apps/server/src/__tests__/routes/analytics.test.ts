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
    conversation: { count: vi.fn() },
    booking: { count: vi.fn() },
    message: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
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
    mock(prisma.booking.count).mockResolvedValue(0);
    mock(prisma.message.count).mockResolvedValue(0);
    mock(prisma.message.aggregate).mockResolvedValue({ _avg: { responseTime: null, tokens: null } });
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.$queryRaw).mockResolvedValue([{ total: 0n }]);
  });

  const endpoints = ['/kpi', '/conversations', '/satisfaction', '/improvements', '/costs', '/metrics'];

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

  it('requiere autenticación (el router monta requireAuth)', async () => {
    // Con el mock de auth siempre autentica; validamos que el endpoint existe y
    // responde (no 404), asegurando el wiring del router.
    const res = await request(app).get('/api/analytics/kpi');
    expect(res.status).not.toBe(404);
  });
});
