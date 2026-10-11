/**
 * Pruebas del comportamiento de CACHÉ (anti-filtración entre tenants) de
 * GET /api/ai/usage y de getMessageQuota. Se usa la caché REAL (lib/cache) y se
 * la vacía en cada caso con `cache.clear()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// El businessId que inyecta el mock de requireAuth se controla por request
// mediante el header `x-test-biz` (default biz_1).
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      userId: 'user_1',
      businessId: String(req.headers['x-test-biz'] ?? 'biz_1'),
      role: 'ADMIN',
    };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
    subscription: { findUnique: vi.fn() },
    message: { count: vi.fn() },
  },
}));
vi.mock('../../services/chatbot', () => ({ processMessage: vi.fn() }));
vi.mock('../../services/ai', () => ({
  listAvailableProviders: vi.fn(() => []),
  getDefaultAIProvider: vi.fn(() => ({ name: 'anthropic' })),
}));
vi.mock('../../services/ai/engine', () => ({
  listEnginesForBusiness: vi.fn(),
  setActiveEngine: vi.fn(),
  setEngineKey: vi.fn(),
}));
vi.mock('../../services/ai/usage', () => ({ getUsageSummary: vi.fn() }));
// NO se mockean lib/cache ni services/billing/quota (se prueban reales).

import { prisma } from '../../lib/prisma';
import { cache } from '../../lib/cache';
import { getUsageSummary } from '../../services/ai/usage';
import { getMessageQuota } from '../../services/billing/quota';
import { aiRouter } from '../../routes/ai';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use(errorHandler);
  return app;
}

describe('caché de GET /api/ai/usage', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    mock(getUsageSummary).mockImplementation(async (businessId: string, days: number) => ({
      businessId,
      days,
    }));
  });

  it('dos requests iguales (mismo businessId y days) calculan una sola vez', async () => {
    const r1 = await request(app).get('/api/ai/usage?days=7').set('x-test-biz', 'biz_1');
    const r2 = await request(app).get('/api/ai/usage?days=7').set('x-test-biz', 'biz_1');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
    expect(mock(getUsageSummary)).toHaveBeenCalledTimes(1);
    expect(mock(getUsageSummary)).toHaveBeenCalledWith('biz_1', 7);
  });

  it('distinto businessId con el mismo days NO comparte caché (sin fuga entre tenants)', async () => {
    const a = await request(app).get('/api/ai/usage?days=7').set('x-test-biz', 'biz_A');
    const b = await request(app).get('/api/ai/usage?days=7').set('x-test-biz', 'biz_B');

    expect(mock(getUsageSummary)).toHaveBeenCalledTimes(2);
    expect(mock(getUsageSummary)).toHaveBeenNthCalledWith(1, 'biz_A', 7);
    expect(mock(getUsageSummary)).toHaveBeenNthCalledWith(2, 'biz_B', 7);
    expect(a.body.businessId).toBe('biz_A');
    expect(b.body.businessId).toBe('biz_B');
  });

  it('distinto days para el mismo negocio usa una clave distinta', async () => {
    await request(app).get('/api/ai/usage?days=7').set('x-test-biz', 'biz_1');
    await request(app).get('/api/ai/usage?days=14').set('x-test-biz', 'biz_1');

    expect(mock(getUsageSummary)).toHaveBeenCalledTimes(2);
  });

  it("days='abc' cae a 30", async () => {
    await request(app).get('/api/ai/usage?days=abc').set('x-test-biz', 'biz_1');
    expect(mock(getUsageSummary)).toHaveBeenCalledTimes(1);
    expect(mock(getUsageSummary)).toHaveBeenCalledWith('biz_1', 30);
  });

  it('days negativo se acota a 1', async () => {
    await request(app).get('/api/ai/usage?days=-5').set('x-test-biz', 'biz_1');
    expect(mock(getUsageSummary)).toHaveBeenCalledWith('biz_1', 1);
  });

  it('days enorme se acota a 365', async () => {
    await request(app).get('/api/ai/usage?days=99999').set('x-test-biz', 'biz_1');
    expect(mock(getUsageSummary)).toHaveBeenCalledWith('biz_1', 365);
  });
});

describe('caché de getMessageQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    mock(prisma.subscription.findUnique).mockResolvedValue({
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      plan: { name: 'Pro', maxMessages: 1000 },
    });
    mock(prisma.message.count).mockResolvedValue(10);
  });

  it('dos llamadas del mismo negocio consultan la DB una sola vez', async () => {
    const q1 = await getMessageQuota('biz_1');
    const q2 = await getMessageQuota('biz_1');

    expect(mock(prisma.message.count)).toHaveBeenCalledTimes(1);
    expect(mock(prisma.subscription.findUnique)).toHaveBeenCalledTimes(1);
    expect(q2).toEqual(q1);
    expect(q1).toMatchObject({ used: 10, limit: 1000, remaining: 990, overQuota: false, plan: 'Pro' });
  });

  it('distinto businessId NO comparte caché (se consulta de nuevo)', async () => {
    mock(prisma.message.count).mockResolvedValueOnce(10).mockResolvedValueOnce(900);

    const a = await getMessageQuota('biz_A');
    const b = await getMessageQuota('biz_B');

    expect(mock(prisma.message.count)).toHaveBeenCalledTimes(2);
    expect(mock(prisma.subscription.findUnique)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { businessId: 'biz_A' } }),
    );
    expect(mock(prisma.subscription.findUnique)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { businessId: 'biz_B' } }),
    );
    expect(a.used).toBe(10);
    expect(b.used).toBe(900);
  });
});
