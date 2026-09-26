/**
 * Pruebas de integración del webhook de WhatsApp (routes/whatsapp.ts):
 * firma, resolución multi-tenant, gate de visión, transcripción de audio y la
 * garantía de responder siempre 200 (para que Twilio no reintente).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: { conversation: { findFirst: vi.fn() } },
}));
vi.mock('../../services/chatbot', () => ({
  processMessage: vi.fn(),
  getActiveSuperpowers: vi.fn(async () => new Set<string>()),
}));
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
    expect(mock(sendMessage)).toHaveBeenCalledWith('+549', 'respuesta');
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

  it('responde 200 aunque processMessage lance (Twilio no debe reintentar)', async () => {
    mock(resolveBusinessByNumber).mockResolvedValue({ businessId: 'biz_1', botId: 'bot_1' });
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(processMessage).mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/whatsapp/webhook').send({ From: 'whatsapp:+549', To: '+1', Body: 'hola' });
    expect(res.status).toBe(200);
  });
});
