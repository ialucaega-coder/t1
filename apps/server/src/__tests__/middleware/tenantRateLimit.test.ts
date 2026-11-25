/**
 * Pruebas de `tenantRateLimit`: tope por negocio (no por IP), 429 al pasarse,
 * contadores separados por negocio y por bucket.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/redis', () => ({ getRedis: () => null }));

import { tenantRateLimit } from '../../middleware/tenantRateLimit';
import { cache } from '../../lib/cache';

function buildApp(max: number, name = 'bucket-a') {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'u', businessId: String(req.header('x-biz') ?? 'biz_1'), role: 'ADMIN' };
    next();
  });
  app.post('/ai', tenantRateLimit({ name, max }), (_req, res) => res.json({ ok: true }));
  return app;
}

const OLD_ENV = { ...process.env };
beforeEach(() => {
  cache.clear();
  process.env.TENANT_RL_FORCE = 'true';
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('middleware/tenantRateLimit', () => {
  it('deja pasar hasta el máximo y responde 429 después', async () => {
    const app = buildApp(2);
    expect((await request(app).post('/ai')).status).toBe(200);
    expect((await request(app).post('/ai')).status).toBe(200);
    const blocked = await request(app).post('/ai');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('el tope es por negocio: otro tenant no se ve afectado', async () => {
    const app = buildApp(1);
    await request(app).post('/ai').set('x-biz', 'biz_1');
    expect((await request(app).post('/ai').set('x-biz', 'biz_1')).status).toBe(429);
    expect((await request(app).post('/ai').set('x-biz', 'biz_2')).status).toBe(200);
  });

  it('buckets distintos no comparten contador', async () => {
    const a = buildApp(1, 'bucket-a');
    const b = buildApp(1, 'bucket-b');
    await request(a).post('/ai');
    expect((await request(b).post('/ai')).status).toBe(200);
  });

  it('en NODE_ENV=test sin TENANT_RL_FORCE no limita (los tests de rutas no dependen del contador)', async () => {
    delete process.env.TENANT_RL_FORCE;
    const app = buildApp(1);
    expect((await request(app).post('/ai')).status).toBe(200);
    expect((await request(app).post('/ai')).status).toBe(200);
  });
});
