/**
 * POST /api/conversations/:id/reply (y /reply/:messageId/retry): la respuesta de
 * un humano se guarda Y llega al canal real. Auth REAL (JWT); se mockean Prisma,
 * el socket y las primitivas de cada canal (Twilio, Meta, ManyChat). El módulo
 * `services/channels/deliver` corre de verdad para comprobar el cableado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    business: { findFirst: vi.fn() },
    connection: { findFirst: vi.fn() },
  },
}));
vi.mock('../../lib/socket', () => ({ getIO: vi.fn(() => null) }));
vi.mock('../../lib/crypto', () => ({ safeDecrypt: vi.fn((v: string) => v) }));
vi.mock('../../services/ai/copilot', () => ({ generateCopilot: vi.fn() }));
vi.mock('../../services/ai/lead-score', () => ({ generateLeadScore: vi.fn() }));
vi.mock('../../services/whatsapp/client', () => ({ sendMessage: vi.fn() }));
vi.mock('../../services/meta/client', () => ({ sendMessage: vi.fn() }));
vi.mock('../../services/manychat/config', () => ({ loadMcConfig: vi.fn() }));
vi.mock('../../services/manychat/client', () => ({ sendText: vi.fn() }));
vi.mock('grammy', () => ({ Api: class { sendMessage = vi.fn(); } }));
vi.mock('../../lib/idempotency', async () => {
  const actual = await vi.importActual<typeof import('../../lib/idempotency')>('../../lib/idempotency');
  return { ...actual, claimIdempotentKey: vi.fn(), releaseIdempotentKey: vi.fn() };
});
vi.mock('../../lib/sharedState', () => ({ sharedIncr: vi.fn().mockResolvedValue(1) }));

import { prisma } from '../../lib/prisma';
import { conversationsRouter } from '../../routes/conversations';
import { errorHandler } from '../../middleware/errorHandler';
import { sendMessage as sendWhatsApp } from '../../services/whatsapp/client';
import { sendMessage as sendMeta } from '../../services/meta/client';
import { sendText as sendManychat } from '../../services/manychat/client';
import { claimIdempotentKey, releaseIdempotentKey } from '../../lib/idempotency';
import { sharedIncr } from '../../lib/sharedState';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const token = jwt.sign({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
  app.use(errorHandler);
  return app;
}

const waConversation = {
  id: 'c1',
  businessId: 'biz_1',
  channel: 'WHATSAPP',
  status: 'OPEN',
  contactPhone: '+5491155550000',
  metadata: null,
};

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return request(buildApp())
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set(headers)
    .send(body ?? {});
}

describe('POST /api/conversations/:id/reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.conversation.findFirst).mockResolvedValue(waConversation);
    m(prisma.conversation.update).mockResolvedValue({});
    m(prisma.user.findFirst).mockResolvedValue({ name: 'Ana Agente' });
    m(prisma.business.findFirst).mockResolvedValue({ whatsappNumber: '+14155550100', phone: null });
    m(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'm1',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      responseTime: null,
      ...data,
    }));
    m(prisma.message.update).mockImplementation(async ({ data }: { data: { metadata: unknown } }) => ({ metadata: data.metadata }));
  });

  it('WhatsApp: guarda el mensaje como humano y lo envía al cliente por Twilio', async () => {
    m(sendWhatsApp).mockResolvedValue('SM999');

    const res = await post('/api/conversations/c1/reply', { text: '  Hola, te ayudo  ' });

    expect(res.status).toBe(200);
    // El envío usa el texto limpio, el teléfono del cliente y el número del negocio.
    expect(sendWhatsApp).toHaveBeenCalledWith('+5491155550000', 'Hola, te ayudo', '+14155550100');
    // Se persiste ANTES de enviar, con el autor humano (rol BOT: el enum no tiene HUMAN).
    const created = m(prisma.message.create).mock.calls[0][0].data;
    expect(created).toMatchObject({
      conversationId: 'c1',
      role: 'BOT',
      text: 'Hola, te ayudo',
      metadata: { sender: 'human', userId: 'user_1', userName: 'Ana Agente', deliveryStatus: 'pending' },
    });
    // Y el resultado queda registrado en la metadata del mensaje.
    expect(m(prisma.message.update).mock.calls[0][0].data.metadata).toMatchObject({
      sender: 'human',
      deliveryStatus: 'sent',
      providerMessageId: 'SM999',
    });
    expect(res.body).toMatchObject({ id: 'm1', text: 'Hola, te ayudo', deliveryStatus: 'sent' });
    expect(res.body.deliveryError).toBeUndefined();
  });

  it('si la entrega falla responde 200 con deliveryStatus failed y el mensaje queda guardado', async () => {
    m(sendWhatsApp).mockRejectedValue(Object.assign(new Error('outside window'), { code: 63016 }));

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(200);
    expect(m(prisma.message.create)).toHaveBeenCalledTimes(1);
    expect(res.body.deliveryStatus).toBe('failed');
    expect(res.body.deliveryError).toMatch(/24 h/);
    expect(res.body.text).toBe('Hola');
    expect(m(prisma.message.update).mock.calls[0][0].data.metadata).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: expect.stringMatching(/24 h/),
    });
  });

  it('multi-tenant: una conversación de otro negocio da 404 y no se guarda ni se envía nada', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue(null);

    const res = await post('/api/conversations/c_ajena/reply', { text: 'Hola' });

    expect(res.status).toBe(404);
    // La búsqueda va siempre scopeada al negocio del token.
    expect(m(prisma.conversation.findFirst).mock.calls[0][0].where).toEqual({ id: 'c_ajena', businessId: 'biz_1' });
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(sendMeta).not.toHaveBeenCalled();
    expect(sendManychat).not.toHaveBeenCalled();
  });

  it('canal WEB (widget): se guarda y devuelve not_applicable sin llamar a ningún proveedor', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue({ ...waConversation, channel: 'WEBCHAT', contactPhone: null });

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(200);
    expect(res.body.deliveryStatus).toBe('not_applicable');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(sendMeta).not.toHaveBeenCalled();
  });

  it('una conversación derivada (HANDOFF) vuelve a OPEN al responder', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue({ ...waConversation, status: 'HANDOFF' });
    m(sendWhatsApp).mockResolvedValue('SM1');

    await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(m(prisma.conversation.update).mock.calls[0][0].data).toMatchObject({ status: 'OPEN' });
  });

  describe('Idempotency-Key', () => {
    it('un duplicado no guarda ni envía de nuevo', async () => {
      m(claimIdempotentKey).mockResolvedValue(false);

      const res = await post('/api/conversations/c1/reply', { text: 'Hola' }, { 'Idempotency-Key': 'k-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ duplicate: true });
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });

    it('la primera vez reserva la clave acotada a negocio y conversación, y envía', async () => {
      m(claimIdempotentKey).mockResolvedValue(true);
      m(sendWhatsApp).mockResolvedValue('SM1');

      const res = await post('/api/conversations/c1/reply', { text: 'Hola' }, { 'Idempotency-Key': 'k-1' });

      expect(res.body.deliveryStatus).toBe('sent');
      expect(claimIdempotentKey).toHaveBeenCalledWith(prisma, 'biz_1', expect.any(String), 'conv-reply:c1:k-1');
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    });

    it('si falla el guardado del mensaje libera la clave, así el reintento no queda como duplicado', async () => {
      m(claimIdempotentKey).mockResolvedValue(true);
      m(prisma.message.create).mockRejectedValue(new Error('db caída'));

      const res = await post('/api/conversations/c1/reply', { text: 'Hola' }, { 'Idempotency-Key': 'k-1' });

      expect(res.status).toBe(500);
      expect(releaseIdempotentKey).toHaveBeenCalledWith(prisma, 'biz_1', expect.any(String), 'conv-reply:c1:k-1');
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });

    it('si el mensaje se guardó y el envío falla NO libera la clave (ya hubo intento externo)', async () => {
      m(claimIdempotentKey).mockResolvedValue(true);
      m(sendWhatsApp).mockRejectedValue(new Error('boom'));

      const res = await post('/api/conversations/c1/reply', { text: 'Hola' }, { 'Idempotency-Key': 'k-1' });

      expect(res.body.deliveryStatus).toBe('failed');
      expect(releaseIdempotentKey).not.toHaveBeenCalled();
    });

    it('sin el header no toca la tabla de idempotencia (compatible con clientes viejos)', async () => {
      m(sendWhatsApp).mockResolvedValue('SM1');

      await post('/api/conversations/c1/reply', { text: 'Hola' });

      expect(claimIdempotentKey).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/conversations/:id/reply/:messageId/retry', () => {
  const failedMessage = {
    id: 'm1',
    conversationId: 'c1',
    role: 'BOT',
    text: 'Hola',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    metadata: { sender: 'human', userId: 'user_1', userName: 'Ana Agente', deliveryStatus: 'failed', deliveryError: 'x', deliveryAttempts: 1 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.conversation.findFirst).mockResolvedValue(waConversation);
    m(prisma.message.findFirst).mockResolvedValue(failedMessage);
    m(prisma.message.updateMany).mockResolvedValue({ count: 1 });
    m(prisma.business.findFirst).mockResolvedValue({ whatsappNumber: '+14155550100', phone: null });
    m(prisma.message.update).mockImplementation(async ({ data }: { data: { metadata: unknown } }) => ({ metadata: data.metadata }));
  });

  it('reenvía el mismo mensaje (sin crear otro) y deja el estado en sent', async () => {
    m(sendWhatsApp).mockResolvedValue('SM2');

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(200);
    expect(sendWhatsApp).toHaveBeenCalledWith('+5491155550000', 'Hola', '+14155550100');
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ deliveryStatus: 'sent' });
    expect(m(prisma.message.update).mock.calls[0][0].data.metadata).toMatchObject({
      deliveryStatus: 'sent',
      deliveryAttempts: 2,
    });
    expect(m(prisma.message.update).mock.calls[0][0].data.metadata.deliveryError).toBeUndefined();
  });

  it('no reintenta un mensaje que ya se envió (409) ni vuelve a llamar al proveedor', async () => {
    m(prisma.message.findFirst).mockResolvedValue({ ...failedMessage, metadata: { ...failedMessage.metadata, deliveryStatus: 'sent' } });

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(409);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('doble click: si otro request ya tomó el reintento (updateMany count 0) no envía de nuevo', async () => {
    m(prisma.message.updateMany).mockResolvedValue({ count: 0 });

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(409);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('multi-tenant: conversación de otro negocio da 404 y no envía', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue(null);

    const res = await post('/api/conversations/c_ajena/reply/m1/retry');

    expect(res.status).toBe(404);
    expect(m(prisma.conversation.findFirst).mock.calls[0][0].where).toEqual({ id: 'c_ajena', businessId: 'biz_1' });
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('tope de intentos: al llegar a 5 responde 409 MAX_ATTEMPTS y no vuelve a enviar', async () => {
    m(prisma.message.findFirst).mockResolvedValue({ ...failedMessage, metadata: { ...failedMessage.metadata, deliveryAttempts: 5 } });

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MAX_ATTEMPTS');
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('con 4 intentos previos todavía permite el quinto', async () => {
    m(prisma.message.findFirst).mockResolvedValue({ ...failedMessage, metadata: { ...failedMessage.metadata, deliveryAttempts: 4 } });
    m(sendWhatsApp).mockResolvedValue('SM5');

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(200);
    expect(m(prisma.message.update).mock.calls[0][0].data.metadata).toMatchObject({ deliveryAttempts: 5 });
  });

  it('no reintenta mensajes que no son respuestas humanas (ej. del bot)', async () => {
    m(prisma.message.findFirst).mockResolvedValue({ ...failedMessage, metadata: null });

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(404);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });
});

describe('rate limit por negocio en reply y retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TENANT_RL_FORCE', 'true');
    m(prisma.conversation.findFirst).mockResolvedValue(waConversation);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    m(sharedIncr).mockResolvedValue(1);
  });

  it('reply: pasado el tope (60/min) responde 429 sin guardar ni enviar', async () => {
    m(sharedIncr).mockResolvedValue(61);

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(429);
    expect(m(sharedIncr).mock.calls[0][0]).toContain('conv-reply:biz_1');
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('retry: comparte el tope y responde 429 sin enviar', async () => {
    m(sharedIncr).mockResolvedValue(61);

    const res = await post('/api/conversations/c1/reply/m1/retry');

    expect(res.status).toBe(429);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });
});
