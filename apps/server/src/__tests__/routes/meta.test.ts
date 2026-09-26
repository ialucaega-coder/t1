/**
 * Pruebas de integración de las rutas de Meta (`src/routes/meta.ts`):
 * verificación del webhook, eventos entrantes, connect y status.
 *
 * Se mockean Prisma, la capa `services/meta/client` y `services/chatbot`.
 * El middleware de auth es el real (JWT firmado con NEXTAUTH_SECRET).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    bot: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
}));

vi.mock('../../services/meta/client', () => ({
  isConfigured: vi.fn(() => true),
  validateSignature: vi.fn(() => true),
  parseMetaEvents: vi.fn(() => []),
  resolveBusinessByRecipient: vi.fn(),
  sendMessage: vi.fn(),
  connectionTypeFor: (p: string) => (p === 'instagram' ? 'INSTAGRAM' : 'MESSENGER'),
}));

vi.mock('../../services/chatbot', () => ({
  processMessage: vi.fn(),
  getActiveSuperpowers: vi.fn(async () => new Set<string>()),
}));

import { prisma } from '../../lib/prisma';
import { parseMetaEvents, resolveBusinessByRecipient, sendMessage } from '../../services/meta/client';
import { processMessage, getActiveSuperpowers } from '../../services/chatbot';
import { metaRouter } from '../../routes/meta';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/meta', metaRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/meta', () => {
  const app = buildApp();
  const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, META_VERIFY_TOKEN: 'verify_me', NODE_ENV: 'test' };
  });

  describe('GET /api/meta/webhook (verificación)', () => {
    it('devuelve el challenge cuando el verify_token coincide', async () => {
      const res = await request(app).get('/api/meta/webhook').query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify_me',
        'hub.challenge': '12345',
      });
      expect(res.status).toBe(200);
      expect(res.text).toBe('12345');
    });

    it('devuelve 403 si el token no coincide', async () => {
      const res = await request(app).get('/api/meta/webhook').query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'malo',
        'hub.challenge': '12345',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/meta/webhook (eventos)', () => {
    it('procesa un mensaje: resuelve negocio, llama al cerebro y responde', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: 'hola', images: [] },
      ]);
      mock(resolveBusinessByRecipient).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
      mock(prisma.conversation.findFirst).mockResolvedValue(null);
      mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

      const res = await request(app).post('/api/meta/webhook').send({ object: 'instagram', entry: [] });
      expect(res.status).toBe(200);

      // El webhook responde 200 y procesa async; esperamos un tick.
      await new Promise((r) => setTimeout(r, 20));
      expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'hola', 'INSTAGRAM', expect.objectContaining({ botId: 'bot_1' }));
      expect(mock(sendMessage)).toHaveBeenCalledWith('tok', 'U9', 'respuesta');
    });

    it('no llama al cerebro si no se resuelve el negocio', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'messenger', recipientId: 'PAGE_X', senderId: 'U', text: 'hi', images: [] },
      ]);
      mock(resolveBusinessByRecipient).mockResolvedValue(null);

      await request(app).post('/api/meta/webhook').send({ object: 'page', entry: [] });
      await new Promise((r) => setTimeout(r, 20));
      expect(mock(processMessage)).not.toHaveBeenCalled();
    });

    it('descarta imágenes si el superpoder "Oído y vista" está apagado', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: 'mirá', images: [{ url: 'https://cdn/x.jpg' }] },
      ]);
      mock(resolveBusinessByRecipient).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
      mock(getActiveSuperpowers).mockResolvedValue(new Set());
      mock(prisma.conversation.findFirst).mockResolvedValue(null);
      mock(processMessage).mockResolvedValue({ text: 'ok', conversationId: 'c1', intent: 'FAQ', actions: [] });

      await request(app).post('/api/meta/webhook').send({ object: 'instagram', entry: [] });
      await new Promise((r) => setTimeout(r, 20));
      const opts = mock(processMessage).mock.calls[0][3];
      expect(opts.images).toBeUndefined();
    });
  });

  describe('POST /api/meta/connect', () => {
    it('401 sin token', async () => {
      const res = await request(app).post('/api/meta/connect').send({ platform: 'instagram', pageAccessToken: 't', igId: 'IG' });
      expect(res.status).toBe(401);
    });

    it('crea la conexión y el bot para Instagram', async () => {
      mock(prisma.bot.findFirst).mockResolvedValue(null);
      mock(prisma.bot.create).mockResolvedValue({ id: 'bot_new', status: 'ACTIVE' });
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'conn_1' });

      const res = await request(app)
        .post('/api/meta/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ platform: 'instagram', pageAccessToken: 'tok', igId: 'IG_1', pageName: 'Mi IG' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, platform: 'instagram', botId: 'bot_new' });
      expect(mock(prisma.connection.create)).toHaveBeenCalled();
    });

    it('400 si no viene ni pageId ni igId', async () => {
      const res = await request(app)
        .post('/api/meta/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ platform: 'messenger', pageAccessToken: 'tok' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/meta/status', () => {
    it('reporta el estado de ambas plataformas', async () => {
      mock(prisma.connection.findMany).mockResolvedValue([
        { type: 'INSTAGRAM', isActive: true, name: 'Instagram — Mi IG', config: { igId: 'IG_1', connectedAt: '2026-01-01' } },
      ]);

      const res = await request(app).get('/api/meta/status').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.instagram.connected).toBe(true);
      expect(res.body.messenger.connected).toBe(false);
    });
  });
});
