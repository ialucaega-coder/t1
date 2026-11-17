/**
 * Pruebas de integración del webhook de WhatsApp (routes/whatsapp.ts):
 * firma, resolución multi-tenant, gate de visión, transcripción de audio y la
 * garantía de responder siempre 200 (para que Twilio no reintente).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: { conversation: { findFirst: vi.fn() }, message: { findFirst: vi.fn() } },
}));
vi.mock('../../services/chatbot', () => ({
  processMessage: vi.fn(),
  getActiveSuperpowers: vi.fn(async () => new Set<string>()),
}));
// Backoff mínimo: los reintentos de la cola corren inline en los tests.
vi.mock('../../services/channels/inboundRetry', async () => {
  const actual = await vi.importActual<typeof import('../../services/channels/inboundRetry')>('../../services/channels/inboundRetry');
  return { ...actual, INBOUND_RETRY: { attempts: 3, backoffMs: 1 } };
});
vi.mock('../../services/ai/transcription', () => ({
  transcribeAudioFromUrl: vi.fn(async () => null),
}));
vi.mock('../../services/whatsapp/client', () => ({
  sendMessage: vi.fn(),
  validateWebhookSignature: vi.fn(() => true),
  isConfigured: vi.fn(() => true),
  resolveBusinessByNumber: vi.fn(),
  parseTwilioImages: vi.fn(() => []),
  parseTwilioAudio: vi.fn(() => []),
  downloadTwilioImagesAsBase64: vi.fn(async () => []),
  getTwilioAuthHeader: vi.fn(() => 'Basic xyz'),
  isTwilioMediaUrl: vi.fn(() => true),
}));

import { prisma } from '../../lib/prisma';
import { processMessage, getActiveSuperpowers } from '../../services/chatbot';
import { transcribeAudioFromUrl } from '../../services/ai/transcription';
import {
  sendMessage,
  resolveBusinessByNumber,
  parseTwilioImages,
  parseTwilioAudio,
  downloadTwilioImagesAsBase64,
} from '../../services/whatsapp/client';
import { whatsappRouter } from '../../routes/whatsapp';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/api/whatsapp', whatsappRouter);
  app.use(errorHandler);
  return app;
}

const OLD_ENV = { ...process.env };

describe('routes/whatsapp — webhook', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto salteamos la validación de firma (dev), salvo el test que la prueba.
    process.env = { ...OLD_ENV, SKIP_WEBHOOK_SIGNATURE_VALIDATION: 'true' };
    mock(parseTwilioImages).mockReturnValue([]);
    mock(parseTwilioAudio).mockReturnValue([]);
    mock(getActiveSuperpowers).mockResolvedValue(new Set());
  });

  it('403 si falta la firma y la validación NO está salteada', async () => {
    delete process.env.SKIP_WEBHOOK_SIGNATURE_VALIDATION;
    const res = await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'hola' });
    expect(res.status).toBe(403);
  });

  it('responde 200 y no procesa si no se resuelve el negocio', async () => {
    mock(resolveBusinessByNumber).mockResolvedValue(null);
    const res = await request(app).post('/api/whatsapp/webhook')
      .send({ From: 'whatsapp:+549', To: '+1', Body: 'hola' });
    expect(res.status).toBe(200);
    expect(mock(processMessage)).not.toHaveBeenCalled();
  });

  it('procesa un mensaje de texto y responde', async () => {
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

    const res = await request(app).post('/api/whatsapp/webhook')
      .send({ From: 'whatsapp:+549', To: '+1', Body: 'hola', ProfileName: 'Ana' });

    expect(res.status).toBe(200);
    expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'hola', 'WHATSAPP', expect.objectContaining({ botId: 'bot_1' }));
    // Responde al cliente (+549) DESDE el número del negocio (el To, +1).
    expect(mock(sendMessage)).toHaveBeenCalledWith('+549', 'respuesta', '+1');
  });

  it('con "Oído y vista" activo, descarga imágenes a base64 y las pasa', async () => {
    mock(parseTwilioImages).mockReturnValue([{ url: 'https://api.twilio.com/m.jpg', mediaType: 'image/jpeg' }]);
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(getActiveSuperpowers).mockResolvedValue(new Set(['Oído y vista']));
    mock(downloadTwilioImagesAsBase64).mockResolvedValue([{ base64: 'AAAA', mediaType: 'image/jpeg' }]);
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(processMessage).mockResolvedValue({ text: 'ok', conversationId: 'c1', intent: 'FAQ', actions: [] });

    await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'mirá' });
    const opts = mock(processMessage).mock.calls[0][3];
    expect(opts.images).toEqual([{ base64: 'AAAA', mediaType: 'image/jpeg' }]);
  });

  it('transcribe una nota de voz y la usa como mensaje', async () => {
    mock(parseTwilioAudio).mockReturnValue([{ url: 'https://api.twilio.com/voz.ogg', mediaType: 'audio/ogg' }]);
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(getActiveSuperpowers).mockResolvedValue(new Set(['Oído y vista']));
    mock(transcribeAudioFromUrl).mockResolvedValue('quiero reservar');
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(processMessage).mockResolvedValue({ text: 'ok', conversationId: 'c1', intent: 'BOOKING', actions: [] });

    // Sin Body: el placeholder "(nota de voz)" pasa la validación y luego lo
    // reemplaza la transcripción.
    await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1' });

    expect(mock(transcribeAudioFromUrl)).toHaveBeenCalled();
    expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'quiero reservar', 'WHATSAPP', expect.anything());
  });

  it('si un humano tomó la conversación (botPaused) NO le contesta al cliente', async () => {
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(prisma.conversation.findFirst).mockResolvedValue({ id: 'c1' });
    mock(processMessage).mockResolvedValue({
      text: 'Una persona del equipo está atendiendo…', conversationId: 'c1', intent: 'FAQ', actions: [], botPaused: true,
    });

    const res = await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'hola' });

    expect(res.status).toBe(200);
    // El mensaje igual se procesa (se guarda en processMessage), pero no sale nada.
    expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'hola', 'WHATSAPP', expect.objectContaining({ conversationId: 'c1' }));
    expect(mock(sendMessage)).not.toHaveBeenCalled();
  });

  it('una conversación derivada (HANDOFF) se reusa: el lookup acepta OPEN y HANDOFF', async () => {
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(processMessage).mockResolvedValue({ text: 'ok', conversationId: 'c1', intent: 'FAQ', actions: [] });

    await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'hola' });

    const where = mock(prisma.conversation.findFirst).mock.calls[0][0].where;
    expect(where).toMatchObject({ businessId: 'biz_1', channel: 'WHATSAPP', contactPhone: '+549', status: { in: ['OPEN', 'HANDOFF'] } });
  });

  it('responde 200 aunque processMessage lance siempre (se agotan los reintentos y no explota)', async () => {
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(prisma.message.findFirst).mockResolvedValue(null);
    mock(processMessage).mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'hola', MessageSid: 'SM_fail' });
    expect(res.status).toBe(200);
    expect(mock(sendMessage)).not.toHaveBeenCalled();
  });

  describe('reintentos de la cola (sin duplicar)', () => {
    const send = (sid: string) =>
      request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'hola', MessageSid: sid });

    beforeEach(() => {
      mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
      mock(prisma.conversation.findFirst).mockResolvedValue(null);
      mock(prisma.message.findFirst).mockResolvedValue(null); // nada guardado todavía
      mock(sendMessage).mockReset().mockResolvedValue('SM_ok');
    });

    it('un fallo ANTES de enviar y sin nada guardado se reintenta y responde UNA sola vez', async () => {
      mock(processMessage)
        .mockRejectedValueOnce(new Error('db caída un instante'))
        .mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

      const res = await send('SM_retry_1');

      expect(res.status).toBe(200);
      expect(mock(processMessage)).toHaveBeenCalledTimes(2);
      expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
      // El chequeo de "¿ya se guardó algo?" va scopeado por negocio y contacto.
      expect(mock(prisma.message.findFirst).mock.calls[0][0].where).toMatchObject({
        conversation: { businessId: 'biz_1', contactPhone: '+549' },
      });
    });

    it('un fallo de lectura de la conversación (previo a procesar) también se reintenta', async () => {
      mock(prisma.conversation.findFirst)
        .mockRejectedValueOnce(new Error('db caída'))
        .mockResolvedValue(null);
      mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

      await send('SM_retry_2');

      expect(mock(processMessage)).toHaveBeenCalledTimes(1);
      expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
    });

    it('un fallo DESPUÉS de procesar (al enviar) NO se reintenta: no regenera ni reenvía', async () => {
      mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });
      mock(sendMessage).mockRejectedValue(new Error('twilio caído'));

      const res = await send('SM_after_send');

      expect(res.status).toBe(200);
      expect(mock(processMessage)).toHaveBeenCalledTimes(1);
      expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
    });

    it('si falló pero ya quedó un mensaje guardado, NO se reintenta (evita duplicar el mensaje del cliente)', async () => {
      mock(processMessage).mockRejectedValue(new Error('falló al guardar la respuesta'));
      mock(prisma.message.findFirst).mockResolvedValue({ id: 'm_user' });

      await send('SM_persisted');

      expect(mock(processMessage)).toHaveBeenCalledTimes(1);
      expect(mock(sendMessage)).not.toHaveBeenCalled();
    });

    it('el mismo MessageSid reenviado por Twilio se procesa UNA sola vez (dedupe por jobId)', async () => {
      mock(processMessage).mockResolvedValue({ text: 'respuesta', conversationId: 'c1', intent: 'FAQ', actions: [] });

      await send('SM_dup');
      await send('SM_dup');

      expect(mock(processMessage)).toHaveBeenCalledTimes(1);
      expect(mock(sendMessage)).toHaveBeenCalledTimes(1);
    });
  });
});
