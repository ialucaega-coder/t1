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
    message: { findFirst: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    // $transaction ejecuta el callback con el mismo `prisma` mockeado como `tx`.
    $transaction: vi.fn(async function (this: unknown, cb: (tx: unknown) => unknown) {
      const { prisma } = await import('../../lib/prisma');
      return cb(prisma);
    }),
  },
}));

// Backoff mínimo: los reintentos de la cola corren inline en los tests.
vi.mock('../../services/channels/inboundRetry', async () => {
  const actual = await vi.importActual<typeof import('../../services/channels/inboundRetry')>('../../services/channels/inboundRetry');
  return { ...actual, INBOUND_RETRY: { attempts: 3, backoffMs: 1 } };
});

vi.mock('../../services/meta/client', () => ({
  isConfigured: vi.fn(() => true),
  validateSignature: vi.fn(() => true),
  parseMetaEvents: vi.fn(() => []),
  resolveBusinessByRecipient: vi.fn(),
  sendMessage: vi.fn(),
  connectionTypeFor: (p: string) => (p === 'instagram' ? 'INSTAGRAM' : 'MESSENGER'),
  verifyTokenOwnership: vi.fn(async () => true),
  isRecipientClaimedByAnother: vi.fn(async () => false),
}));

vi.mock('../../services/chatbot', () => ({
  processMessage: vi.fn(),
  getActiveSuperpowers: vi.fn(async () => new Set<string>()),
}));
vi.mock('../../services/ai/transcription', () => ({
  transcribeAudioFromUrl: vi.fn(async () => null),
}));

import { prisma } from '../../lib/prisma';
import {
  parseMetaEvents,
  resolveBusinessByRecipient,
  sendMessage,
  verifyTokenOwnership,
  isRecipientClaimedByAnother,
} from '../../services/meta/client';
import { processMessage, getActiveSuperpowers } from '../../services/chatbot';
import { transcribeAudioFromUrl } from '../../services/ai/transcription';
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
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: 'hola', images: [], audios: [] },
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

    it('si un humano tomó la conversación (botPaused) NO se le contesta al cliente y el lookup incluye HANDOFF', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: 'hola', images: [], audios: [] },
      ]);
      mock(resolveBusinessByRecipient).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
      mock(prisma.conversation.findFirst).mockResolvedValue({ id: 'c1' });
      mock(processMessage).mockResolvedValue({ text: 'aviso', conversationId: 'c1', intent: 'FAQ', actions: [], botPaused: true });

      await request(app).post('/api/meta/webhook').send({ object: 'instagram', entry: [] });
      await new Promise((r) => setTimeout(r, 20));

      expect(mock(prisma.conversation.findFirst).mock.calls[0][0].where).toMatchObject({
        businessId: 'biz_1', contactPhone: 'U9', status: { in: ['OPEN', 'HANDOFF'] },
      });
      expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'hola', 'INSTAGRAM', expect.objectContaining({ conversationId: 'c1' }));
      expect(mock(sendMessage)).not.toHaveBeenCalled();
    });

    describe('reintentos de la cola (sin duplicar)', () => {
      const ev = (mid: string) => [
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: 'hola', images: [], audios: [], mid },
      ];
      const fire = async () => {
        await request(app).post('/api/meta/webhook').send({ object: 'instagram', entry: [] });
        await new Promise((r) => setTimeout(r, 60));
      };

      beforeEach(() => {
        mock(resolveBusinessByRecipient).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
        mock(prisma.conversation.findFirst).mockResolvedValue(null);
        mock(prisma.message.findFirst).mockResolvedValue(null);
        mock(sendMessage).mockReset().mockResolvedValue(undefined);
      });

      it('un fallo antes de enviar y sin nada guardado se reintenta y responde UNA sola vez', async () => {
        mock(parseMetaEvents).mockReturnValue(ev('mid_retry'));
        mock(processMessage)
          .mockRejectedValueOnce(new Error('db caída un instante'))
          .mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

        await fire();

        expect(mock(processMessage)).toHaveBeenCalledTimes(2);
        expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
        expect(mock(prisma.message.findFirst).mock.calls[0][0].where).toMatchObject({
          conversation: { businessId: 'biz_1', contactPhone: 'U9' },
        });
      });

      it('un fallo al resolver el negocio (antes de todo) se reintenta', async () => {
        mock(parseMetaEvents).mockReturnValue(ev('mid_resolve'));
        mock(resolveBusinessByRecipient)
          .mockRejectedValueOnce(new Error('db caída'))
          .mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
        mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

        await fire();

        expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
      });

      it('un fallo DESPUÉS de procesar (al enviar) NO se reintenta', async () => {
        mock(parseMetaEvents).mockReturnValue(ev('mid_after'));
        mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });
        mock(sendMessage).mockRejectedValue(new Error('meta caído'));

        await fire();

        expect(mock(processMessage)).toHaveBeenCalledTimes(1);
        expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
      });

      it('si ya quedó un mensaje guardado NO se reintenta', async () => {
        mock(parseMetaEvents).mockReturnValue(ev('mid_persisted'));
        mock(processMessage).mockRejectedValue(new Error('falló al guardar la respuesta'));
        mock(prisma.message.findFirst).mockResolvedValue({ id: 'm_user' });

        await fire();

        expect(mock(processMessage)).toHaveBeenCalledTimes(1);
        expect(mock(sendMessage)).not.toHaveBeenCalled();
      });

      it('el mismo mid reenviado por Meta se procesa UNA sola vez', async () => {
        mock(parseMetaEvents).mockReturnValue(ev('mid_dup'));
        mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

        await fire();
        await fire();

        expect(mock(processMessage)).toHaveBeenCalledTimes(1);
        expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
      });
    });

    it('no llama al cerebro si no se resuelve el negocio', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'messenger', recipientId: 'PAGE_X', senderId: 'U', text: 'hi', images: [], audios: [] },
      ]);
      mock(resolveBusinessByRecipient).mockResolvedValue(null);

      await request(app).post('/api/meta/webhook').send({ object: 'page', entry: [] });
      await new Promise((r) => setTimeout(r, 20));
      expect(mock(processMessage)).not.toHaveBeenCalled();
    });

    it('descarta imágenes si el superpoder "Oído y vista" está apagado', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: 'mirá', images: [{ url: 'https://cdn/x.jpg' }], audios: [] },
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

    it('transcribe una nota de voz y la usa como mensaje (Oído y vista activo)', async () => {
      mock(parseMetaEvents).mockReturnValue([
        { platform: 'instagram', recipientId: 'IG_1', senderId: 'U9', text: '', images: [], audios: [{ url: 'https://cdn/voz.mp4' }] },
      ]);
      mock(resolveBusinessByRecipient).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
      mock(getActiveSuperpowers).mockResolvedValue(new Set(['Oído y vista']));
      mock(transcribeAudioFromUrl).mockResolvedValue('quiero un turno el martes');
      mock(prisma.conversation.findFirst).mockResolvedValue(null);
      mock(processMessage).mockResolvedValue({ text: 'ok', conversationId: 'c1', intent: 'BOOKING', actions: [] });

      await request(app).post('/api/meta/webhook').send({ object: 'instagram', entry: [] });
      await new Promise((r) => setTimeout(r, 20));
      expect(mock(transcribeAudioFromUrl)).toHaveBeenCalledWith('https://cdn/voz.mp4');
      expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'quiero un turno el martes', 'INSTAGRAM', expect.anything());
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

    it('400 si el token no controla la identidad declarada (anti-hijack)', async () => {
      mock(verifyTokenOwnership).mockResolvedValue(false);
      const res = await request(app)
        .post('/api/meta/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ platform: 'instagram', pageAccessToken: 'tok', igId: 'IG_AJENO' });
      expect(res.status).toBe(400);
    });

    it('409 si otro negocio ya reclamó esa identidad', async () => {
      mock(verifyTokenOwnership).mockResolvedValue(true);
      mock(isRecipientClaimedByAnother).mockResolvedValue(true);
      const res = await request(app)
        .post('/api/meta/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ platform: 'instagram', pageAccessToken: 'tok', igId: 'IG_1' });
      expect(res.status).toBe(409);
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
