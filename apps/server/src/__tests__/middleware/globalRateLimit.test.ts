/**
 * Límite global por IP (middleware/rateLimit.ts → globalRateLimit): el polling del
 * chat público queda fuera (tiene sus propios límites), pero el POST /chat y el
 * resto de las rutas públicas SIGUEN contando.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/redis', () => ({ getRedis: () => null }));

import { globalRateLimit, isRateLimitExempt } from '../../middleware/rateLimit';

function buildApp() {
  const app = express();
  app.set('trust proxy', true); // cada test usa su propia IP vía X-Forwarded-For
  app.use(globalRateLimit);
  app.use((_req, res) => res.json({ ok: true }));
  return app;
}
const app = buildApp();
let n = 0;
let ip = '';

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  ip = `10.9.${Math.floor(++n / 250)}.${n % 250}`;
});

async function hit(method: 'get' | 'post', path: string, times: number) {
  let last = 200;
  for (let i = 0; i < times; i++) {
    last = (await request(app)[method](path).set('X-Forwarded-For', ip)).status;
  }
  return last;
}

describe('globalRateLimit', () => {
  it('NO cuenta el GET del polling del chat público (más de 300 consultas siguen pasando)', async () => {
    expect(await hit('get', '/api/public/chat/bot1/messages?conversationId=c1', 310)).toBe(200);
    // y como no consumió cupo, el POST /chat de esa misma IP sigue pasando
    expect(await hit('post', '/api/public/chat', 1)).toBe(200);
  });

  it('SÍ cuenta el POST /chat: pasados 300 en la ventana devuelve 429', async () => {
    expect(await hit('post', '/api/public/chat', 301)).toBe(429);
  });

  it('SÍ cuenta las demás rutas públicas (bot, reservas)', async () => {
    expect(await hit('get', '/api/public/bot/bot1', 301)).toBe(429);
  });

  it('la exención es solo para GET de /chat/:botId/messages', () => {
    expect(isRateLimitExempt('GET', '/api/public/chat/bot1/messages')).toBe(true);
    expect(isRateLimitExempt('POST', '/api/public/chat/bot1/messages')).toBe(false);
    expect(isRateLimitExempt('GET', '/api/public/chat/bot1/messages/extra')).toBe(false);
    expect(isRateLimitExempt('GET', '/api/public/chat/a/b/messages')).toBe(false);
    expect(isRateLimitExempt('POST', '/api/public/chat')).toBe(false);
  });

  it('los webhooks de terceros siguen exentos', () => {
    expect(isRateLimitExempt('POST', '/api/meta/webhook')).toBe(true);
  });
});
