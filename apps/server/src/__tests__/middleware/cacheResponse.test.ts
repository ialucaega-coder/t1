/**
 * Pruebas de `cacheResponse`: sirve la respuesta 200 cacheada por negocio+URL,
 * no cachea errores y no mezcla tenants.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { cacheResponse } from '../../middleware/cacheResponse';
import { cache } from '../../lib/cache';

function buildApp(handler: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'u', businessId: String(req.header('x-biz') ?? 'biz_1'), role: 'ADMIN' };
    next();
  });
  app.get('/x', cacheResponse(60_000), (req, res) => {
    handler();
    if (req.query.fail) {
      res.status(500).json({ error: 'boom' });
      return;
    }
    res.json({ n: handler.mock.calls.length });
  });
  return app;
}

describe('middleware/cacheResponse', () => {
  beforeEach(() => cache.clear());

  it('la segunda llamada sale de la caché (el handler corre una vez)', async () => {
    const handler = vi.fn();
    const app = buildApp(handler);
    const a = await request(app).get('/x');
    const b = await request(app).get('/x');
    expect(a.body).toEqual({ n: 1 });
    expect(b.body).toEqual({ n: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('distinta query = distinta entrada', async () => {
    const handler = vi.fn();
    const app = buildApp(handler);
    await request(app).get('/x?a=1');
    await request(app).get('/x?a=2');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('no mezcla negocios: otro tenant calcula su propia respuesta', async () => {
    const handler = vi.fn();
    const app = buildApp(handler);
    await request(app).get('/x').set('x-biz', 'biz_1');
    await request(app).get('/x').set('x-biz', 'biz_2');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('no cachea respuestas de error', async () => {
    const handler = vi.fn();
    const app = buildApp(handler);
    await request(app).get('/x?fail=1');
    await request(app).get('/x?fail=1');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
