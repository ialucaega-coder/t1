/**
 * Pruebas de integración de las rutas de onboarding (`src/routes/onboarding.ts`):
 * GET devuelve el checklist; PUT /dismiss valida el body y persiste el flag. El
 * servicio se mockea; el router asume que requireAuth inyectó req.auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

const sampleOnboarding = {
  items: [{ id: 'brand', label: 'x', description: 'y', done: false, href: '/voz-de-marca' }],
  completed: 0,
  total: 8,
  percent: 0,
  dismissed: false,
};

vi.mock('../../services/onboarding/checklist', () => ({
  buildOnboarding: vi.fn(async () => sampleOnboarding),
  setDismissed: vi.fn(async () => undefined),
}));

import { onboardingRouter } from '../../routes/onboarding';
import { buildOnboarding, setDismissed } from '../../services/onboarding/checklist';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  });
  app.use('/api/onboarding', onboardingRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/onboarding', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  it('GET devuelve el checklist del negocio (scope por businessId)', async () => {
    const res = await request(app).get('/api/onboarding');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 8, percent: 0 });
    expect(buildOnboarding).toHaveBeenCalledWith('biz_1');
  });

  it('PUT /dismiss persiste el flag y devuelve el checklist', async () => {
    const res = await request(app).put('/api/onboarding/dismiss').send({ dismissed: true });
    expect(res.status).toBe(200);
    expect(setDismissed).toHaveBeenCalledWith('biz_1', true);
    expect(res.body).toMatchObject({ total: 8 });
  });

  it('PUT /dismiss devuelve 400 si falta dismissed (validación Zod)', async () => {
    const res = await request(app).put('/api/onboarding/dismiss').send({});
    expect(res.status).toBe(400);
    expect(setDismissed).not.toHaveBeenCalled();
  });
});
