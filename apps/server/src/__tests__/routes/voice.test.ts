/**
 * Pruebas de integración para el asistente de voz (`src/routes/voice.ts`):
 *   - GET/PUT /config (autenticadas; PUT solo ADMIN, con zod)
 *   - Webhooks de Twilio POST /incoming y /respond (sin auth) → devuelven TwiML.
 *
 * En test seteamos SKIP_WEBHOOK_SIGNATURE_VALIDATION=true, así que la
 * verificación de firma de Twilio se omite (ver `verifiedTwilio`). Se mockean la config de voz,
 * el cliente de voz (incluido un VoiceResponse falso), el cerebro (processMessage)
 * y Prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/voice/client', () => {
  // VoiceResponse falso: registra llamadas y serializa a un XML de juguete.
  // Se define DENTRO del factory porque vi.mock se iza al tope del archivo y
  // no puede referenciar variables del scope externo.
  class FakeVoiceResponse {
    // Última instancia creada: los tests inspeccionan qué se dijo/colgó.
    static last: FakeVoiceResponse | null = null;
    constructor() {
      FakeVoiceResponse.last = this;
    }
    say = vi.fn();
    hangup = vi.fn();
    redirect = vi.fn();
    gather = vi.fn(() => ({ say: vi.fn() }));
    toString() {
      return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    }
  }
  return {
    isVoiceConfigured: vi.fn(() => true),
    validateVoiceSignature: vi.fn(() => true),
    resolveBusinessByNumber: vi.fn(),
    VoiceResponse: FakeVoiceResponse,
  };
});

vi.mock('../../services/voice/config', () => ({
  loadVoiceSettings: vi.fn(),
  saveVoiceSettings: vi.fn(),
  interpolate: vi.fn((tpl: string) => tpl),
}));

vi.mock('../../services/chatbot', () => ({
  processMessage: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
}));

import { isVoiceConfigured, resolveBusinessByNumber, VoiceResponse } from '../../services/voice/client';
import { loadVoiceSettings, saveVoiceSettings } from '../../services/voice/config';
import { processMessage } from '../../services/chatbot';
import { prisma } from '../../lib/prisma';
import { voiceRouter } from '../../routes/voice';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT') {
  return jwt.sign({ userId: 'user_1', businessId: 'biz_1', role }, JWT_SECRET);
}

function buildApp() {
  const app = express();
  // El router monta su propio parser urlencoded (Twilio), no hace falta json aquí,
  // pero lo agregamos para las rutas de config del panel.
  app.use(express.json());
  app.use('/api/voice', voiceRouter);
  app.use(errorHandler);
  return app;
}

const CFG = {
  enabled: true,
  assistantName: 'Mía',
  language: 'es-MX',
  voice: 'Polly.Mia',
  rate: 1,
  greeting: 'Hola, soy {asistente} de {negocio}',
  closing: 'Gracias por llamar',
  reprompt: '¿Seguís ahí?',
  persona: 'Sos amable',
};

describe('routes/voice', () => {
  const app = buildApp();
  const adminToken = signToken('ADMIN');
  const clientToken = signToken('CLIENT');

  beforeEach(() => {
    vi.clearAllMocks();
    // Los webhooks de Twilio ahora validan firma por defecto; en test la
    // omitimos con el opt-in explícito (igual que whatsapp.test.ts).
    process.env.SKIP_WEBHOOK_SIGNATURE_VALIDATION = 'true';
    (loadVoiceSettings as ReturnType<typeof vi.fn>).mockResolvedValue(CFG);
  });

  describe('GET /api/voice/config', () => {
    it('devuelve la config de voz (autenticado)', async () => {
      const res = await request(app).get('/api/voice/config').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ assistantName: 'Mía', voice: 'Polly.Mia' });
    });

    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/voice/config');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/voice/status', () => {
    it('reporta si Twilio está configurado', async () => {
      (isVoiceConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const res = await request(app).get('/api/voice/status').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.enabled).toBe(true);
    });
  });

  describe('PUT /api/voice/config', () => {
    it('actualiza la config con un patch válido (ADMIN)', async () => {
      (saveVoiceSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CFG, assistantName: 'Leo' });

      const res = await request(app)
        .put('/api/voice/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assistantName: 'Leo' });

      expect(res.status).toBe(200);
      expect(res.body.assistantName).toBe('Leo');
      expect(saveVoiceSettings).toHaveBeenCalledWith('biz_1', expect.objectContaining({ assistantName: 'Leo' }));
    });

    it('devuelve 400 si rate está fuera de rango', async () => {
      const res = await request(app)
        .put('/api/voice/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rate: 5 });

      expect(res.status).toBe(400);
      expect(saveVoiceSettings).not.toHaveBeenCalled();
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .put('/api/voice/config')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ assistantName: 'Leo' });

      expect(res.status).toBe(403);
      expect(saveVoiceSettings).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/voice/incoming (webhook Twilio)', () => {
    it('responde TwiML XML cuando el número pertenece a un negocio activo', async () => {
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');
      (prisma.business.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Barbería X' });

      const res = await request(app)
        .post('/api/voice/incoming')
        .type('form')
        .send({ To: '+5491100000000', From: '+5491111111111' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      // No requiere Authorization (webhook externo).
    });

    it('cierra la llamada si el número no pertenece a ningún negocio', async () => {
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/voice/incoming')
        .type('form')
        .send({ To: '+000' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
    });
  });

  describe('POST /api/voice/respond (webhook Twilio)', () => {
    it('pasa la transcripción al cerebro por el canal VOICE y responde TwiML', async () => {
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'Claro, te ayudo', actions: [] });

      const res = await request(app)
        .post('/api/voice/respond')
        .type('form')
        .send({ To: '+5491100000000', From: '+5491111111111', SpeechResult: 'Quiero un turno' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(processMessage).toHaveBeenCalledWith(
        'biz_1',
        'Quiero un turno',
        'VOICE',
        expect.objectContaining({ contactPhone: '+5491111111111' })
      );
    });

    it('con un humano a cargo (botPaused) avisa y corta la llamada; el lookup incluye HANDOFF', async () => {
      (loadVoiceSettings as ReturnType<typeof vi.fn>).mockResolvedValue(CFG);
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      (processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'Una persona del equipo te va a atender', actions: [], botPaused: true,
      });

      const res = await request(app)
        .post('/api/voice/respond')
        .type('form')
        .send({ To: '+5491100000000', From: '+5491111111111', SpeechResult: 'hola' });

      expect(res.status).toBe(200);
      expect((prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toMatchObject({
        businessId: 'biz_1', status: { in: ['OPEN', 'HANDOFF'] },
      });
      const twiml = (VoiceResponse as unknown as { last: { say: ReturnType<typeof vi.fn>; hangup: ReturnType<typeof vi.fn>; gather: ReturnType<typeof vi.fn> } }).last;
      expect(twiml.say).toHaveBeenCalledWith(expect.anything(), 'Una persona del equipo te va a atender');
      expect(twiml.hangup).toHaveBeenCalled();
      // No vuelve a pedir otro turno de voz.
      expect(twiml.gather).not.toHaveBeenCalled();
    });

    it('con un humano a cargo y el aviso ya dado (texto vacío) igual le dice algo a quien llama antes de cortar', async () => {
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');
      (loadVoiceSettings as ReturnType<typeof vi.fn>).mockResolvedValue(CFG);
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      (processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ text: '', actions: [], botPaused: true });

      await request(app)
        .post('/api/voice/respond')
        .type('form')
        .send({ To: '+5491100000000', From: '+5491111111111', SpeechResult: 'hola' });

      const twiml = (VoiceResponse as unknown as { last: { say: ReturnType<typeof vi.fn>; hangup: ReturnType<typeof vi.fn> } }).last;
      expect(twiml.say).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/persona del equipo/));
      expect(twiml.hangup).toHaveBeenCalled();
    });

    it('la búsqueda de conversación filtra por canal VOICE (metadata.realChannel) y número', async () => {
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');
      (loadVoiceSettings as ReturnType<typeof vi.fn>).mockResolvedValue(CFG);
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c_voz' });
      (processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'ok', actions: [] });

      await request(app)
        .post('/api/voice/respond')
        .type('form')
        .send({ To: '+5491100000000', From: '+5491111111111', SpeechResult: 'hola' });

      expect((prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toMatchObject({
        businessId: 'biz_1',
        contactPhone: '+5491111111111',
        metadata: { path: ['realChannel'], equals: 'VOICE' },
      });
      expect(processMessage).toHaveBeenCalledWith('biz_1', 'hola', 'VOICE', expect.objectContaining({ conversationId: 'c_voz' }));
    });

    it.each(['', 'anonymous', 'restricted', '+266696687', '+86282452253'])(
      'con From %j (vacío/anónimo) NO reusa conversaciones: arranca una nueva sin historial de otro llamante',
      async (from) => {
        (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');
        (loadVoiceSettings as ReturnType<typeof vi.fn>).mockResolvedValue(CFG);
        (processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'ok', actions: [] });

        await request(app)
          .post('/api/voice/respond')
          .type('form')
          .send({ To: '+5491100000000', From: from, CallSid: 'CA123', SpeechResult: 'hola' });

        expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
        const opts = (processMessage as ReturnType<typeof vi.fn>).mock.calls[0][3];
        expect(opts.conversationId).toBeUndefined();
        // Sin teléfono compartido; la continuidad dentro de la misma llamada va por CallSid.
        expect(opts.contactPhone).toBeUndefined();
        expect(opts.subscriberId).toBe('voice-call:CA123');
      }
    );

    it('repregunta cuando no hubo transcripción (SpeechResult vacío)', async () => {
      (resolveBusinessByNumber as ReturnType<typeof vi.fn>).mockResolvedValue('biz_1');

      const res = await request(app)
        .post('/api/voice/respond')
        .type('form')
        .send({ To: '+5491100000000', From: '+5491111111111', SpeechResult: '' });

      expect(res.status).toBe(200);
      expect(processMessage).not.toHaveBeenCalled();
    });
  });
});
