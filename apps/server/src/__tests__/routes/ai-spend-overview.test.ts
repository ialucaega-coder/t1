/**
 * GET /api/ai/spend-overview (Super Admin): gasto del mes por negocio, con tope, nivel y plan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: { connection: { findMany: vi.fn() }, business: { findMany: vi.fn() } },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'u', businessId: 'b', role: 'ADMIN' };
    next();
  },
  requireRole: () => (_q: Request, _s: Response, next: NextFunction) => next(),
}));
vi.mock('../../middleware/platformAdmin', () => ({
  requirePlatformAdmin: (_q: Request, _s: Response, next: NextFunction) => next(),
}));
vi.mock('../../services/chatbot', () => ({ processMessage: vi.fn() }));
vi.mock('../../services/ai', () => ({ listAvailableProviders: vi.fn(), getDefaultAIProvider: vi.fn() }));
vi.mock('../../services/ai/engine', () => ({
  listEnginesForBusiness: vi.fn(), setActiveEngine: vi.fn(), setEngineKey: vi.fn(), UnknownEngineError: class extends Error {},
}));
vi.mock('../../services/ai/usage', () => ({
  getUsageSummary: vi.fn(),
  currentMonthWindow: () => ({ month: '2026-11', since: new Date('2026-11-01T00:00:00Z') }),
  getSpendByBusinessSince: vi.fn(),
}));
vi.mock('../../services/billing/quota', () => ({ getMessageQuota: vi.fn() }));

import { prisma } from '../../lib/prisma';
import { getSpendByBusinessSince } from '../../services/ai/usage';
import { aiRouter } from '../../routes/ai';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const app = express().use(express.json()).use('/api/ai', aiRouter).use(errorHandler);

beforeEach(() => vi.clearAllMocks());

describe('GET /api/ai/spend-overview', () => {
  it('incluye el plan de cada negocio (null si no tiene suscripción)', async () => {
    mock(getSpendByBusinessSince).mockResolvedValue(new Map([['a', 12], ['b', 3]]));
    mock(prisma.connection.findMany).mockResolvedValue([{ businessId: 'a', config: { capUsd: 10 } }]);
    mock(prisma.business.findMany).mockResolvedValue([
      { id: 'a', name: 'Alfa', subscription: { plan: { name: 'Mr Go +' } } },
      { id: 'b', name: 'Beta', subscription: null },
    ]);

    const res = await request(app).get('/api/ai/spend-overview');

    expect(res.status).toBe(200);
    expect(res.body.businesses).toEqual([
      expect.objectContaining({ businessId: 'a', name: 'Alfa', planName: 'Mr Go +', spentUsd: 12, capUsd: 10, level: 'blocked' }),
      expect.objectContaining({ businessId: 'b', name: 'Beta', planName: null, spentUsd: 3, capUsd: null }),
    ]);
    // Una sola consulta de negocios, con el plan en el mismo select (sin N+1).
    expect(prisma.business.findMany).toHaveBeenCalledTimes(1);
    expect(mock(prisma.business.findMany).mock.calls[0][0].select.subscription).toEqual({ select: { plan: { select: { name: true } } } });
  });
});
