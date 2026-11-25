/**
 * Endpoints públicos de tracking (routes/tracking.ts): pixel de apertura y redirección de clics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const record = vi.fn(async (..._a: unknown[]) => true);
vi.mock('../../services/campaigns/tracking', async (orig) => ({
  ...(await orig<typeof import('../../services/campaigns/tracking')>()),
  recordTrackingEvent: (...a: unknown[]) => record(...a),
}));

import { trackingRouter } from '../../routes/tracking';
import { signTrackingToken } from '../../services/campaigns/tracking';

const app = express().use('/api/public/track', trackingRouter);

beforeEach(() => vi.clearAllMocks());

describe('GET /o/:token.gif', () => {
  it('devuelve el GIF y registra la apertura con un token válido', async () => {
    const t = signTrackingToken({ k: 'o', b: 'b1', c: 'c1', r: 'u1' });
    const res = await request(app).get(`/api/public/track/o/${t}.gif`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/gif/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(record).toHaveBeenCalledWith({ k: 'o', b: 'b1', c: 'c1', r: 'u1' });
  });

  it('con un token inválido igual devuelve el GIF pero no registra nada', async () => {
    const res = await request(app).get('/api/public/track/o/basura.gif');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/gif/);
    expect(record).not.toHaveBeenCalled();
  });

  it('un token de clic no cuenta como apertura', async () => {
    const t = signTrackingToken({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'https://x.com' });
    await request(app).get(`/api/public/track/o/${t}.gif`);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('GET /c/:token', () => {
  it('registra el clic y redirige 302 a la URL firmada', async () => {
    const t = signTrackingToken({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'https://tienda.com/oferta?x=1' });
    const res = await request(app).get(`/api/public/track/c/${t}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://tienda.com/oferta?x=1');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('token inválido o alterado: 404 sin redirigir ni registrar (no es un open redirect)', async () => {
    const t = signTrackingToken({ k: 'c', b: 'b1', c: 'c1', r: 'u1', u: 'https://tienda.com' }) as string;
    const forged = Buffer.from('{"k":"c","b":"b1","c":"c1","r":"u1","u":"https://evil.com"}').toString('base64url');
    for (const bad of ['basura', t.slice(0, -2) + 'xx', `${forged}.${t.split('.')[1]}`]) {
      const res = await request(app).get(`/api/public/track/c/${bad}`);
      expect(res.status).toBe(404);
      expect(res.headers.location).toBeUndefined();
    }
    expect(record).not.toHaveBeenCalled();
  });
});
