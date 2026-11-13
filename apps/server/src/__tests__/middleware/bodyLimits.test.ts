/**
 * Límite de cuerpo por ruta (middleware/bodyLimits.ts): 100 KB en rutas públicas
 * (/api/public, /api/auth) y 5 MB en el resto; los errores del body-parser salen
 * como 413/400 (no como 500).
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/errorHandler';
import {
  isPublicBodyPath,
  jsonBodyParser,
  publicBodySizeGuard,
  PUBLIC_BODY_LIMIT_BYTES,
} from '../../middleware/bodyLimits';

function buildApp() {
  const app = express();
  app.use(publicBodySizeGuard);
  app.use(jsonBodyParser((req, _res, buf) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
  }));
  const echo = (req: express.Request, res: express.Response) =>
    res.json({ bytes: JSON.stringify(req.body).length, raw: Boolean((req as { rawBody?: Buffer }).rawBody) });
  app.post('/api/public/chat', echo);
  app.post('/api/auth/login', echo);
  app.post('/api/meta/webhook', echo);
  app.post('/api/products', echo);
  app.use(errorHandler);
  return app;
}

const bigBody = (kb: number) => ({ text: 'x'.repeat(kb * 1024) });

describe('middleware/bodyLimits', () => {
  const app = buildApp();

  it('isPublicBodyPath: solo /api/public y /api/auth (con límite de segmento)', () => {
    expect(isPublicBodyPath('/api/public/chat')).toBe(true);
    expect(isPublicBodyPath('/api/auth/login')).toBe(true);
    expect(isPublicBodyPath('/api/public')).toBe(true);
    expect(isPublicBodyPath('/api/publicity')).toBe(false);
    expect(isPublicBodyPath('/api/meta/webhook')).toBe(false);
    expect(isPublicBodyPath('/api/products')).toBe(false);
  });

  it('una ruta pública acepta cuerpos normales (< 100 KB) y conserva el rawBody', async () => {
    const res = await request(app).post('/api/public/chat').send(bigBody(50));
    expect(res.status).toBe(200);
    expect(res.body.raw).toBe(true);
  });

  it('una ruta pública rechaza con 413 un cuerpo > 100 KB', async () => {
    const res = await request(app).post('/api/public/chat').send(bigBody(150));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Payload demasiado grande');
  });

  it('/api/auth también está limitada', async () => {
    const res = await request(app).post('/api/auth/login').send(bigBody(150));
    expect(res.status).toBe(413);
  });

  it('el límite del parser corta aunque no haya Content-Length (chunked)', async () => {
    const payload = JSON.stringify(bigBody(150));
    expect(Buffer.byteLength(payload)).toBeGreaterThan(PUBLIC_BODY_LIMIT_BYTES);
    // El server responde 413 y corta la conexión mientras el cliente sigue enviando, así que
    // el cliente de test ve el 413 o, según el timing, un ECONNRESET: ambos son rechazo.
    try {
      const res = await request(app)
        .post('/api/public/chat')
        .set('Content-Type', 'application/json')
        .set('Transfer-Encoding', 'chunked')
        .send(payload);
      expect(res.status).toBe(413);
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ECONNRESET');
    }
  });

  it('las demás rutas (incluidos webhooks) siguen aceptando cuerpos grandes', async () => {
    const meta = await request(app).post('/api/meta/webhook').send(bigBody(300));
    expect(meta.status).toBe(200);
    const products = await request(app).post('/api/products').send(bigBody(300));
    expect(products.status).toBe(200);
  });

  it('JSON mal formado responde 400, no 500', async () => {
    const res = await request(app)
      .post('/api/public/chat')
      .set('Content-Type', 'application/json')
      .send('{"text": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Solicitud inválida');
  });
});
