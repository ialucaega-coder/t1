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
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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
    m(prisma.conversation.update).mockImplementation(async ({ data }: { data: { metadata?: unknown } }) => ({ metadata: data.metadata }));
    // Escrituras de metadata: transacción con lock FOR UPDATE (la fila existe).
    m(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    m(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    m(prisma.conversation.findUnique).mockResolvedValue({ metadata: null });
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

  it('una conversación derivada (HANDOFF) pasa a OPEN + botPaused en UNA sola escritura atómica', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue({ ...waConversation, status: 'HANDOFF' });
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'HANDOFF', metadata: { waitingSince: '2026-01-01T00:00:00.000Z' } });
    m(sendWhatsApp).mockResolvedValue('SM1');

    await post('/api/conversations/c1/reply', { text: 'Hola' });

    // status y metadata viajan en el MISMO update (no puede quedar pausada + HANDOFF).
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
    const data = m(prisma.conversation.update).mock.calls[0][0].data;
    expect(data.status).toBe('OPEN');
    expect(data.metadata).toMatchObject({ botPaused: true, pausedBy: 'user_1' });
    expect(data.metadata.waitingSince).toBeUndefined();
  });

  it('sobre una conversación CERRADA responde 409 y no guarda ni envía nada', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue({ ...waConversation, status: 'CLOSED' });

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONVERSATION_CLOSED');
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('si se cerró justo entre la lectura y la transición también se rechaza (409) sin guardar', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'CLOSED', metadata: null });

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(409);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('aunque la entrega falle, el bot queda pausado (el humano ya la tomó) y la respuesta marca el fallo', async () => {
    m(sendWhatsApp).mockRejectedValue(new Error('boom'));

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(200);
    expect(res.body.deliveryStatus).toBe('failed');
    const data = m(prisma.conversation.update).mock.calls[0][0].data;
    expect(data.metadata).toMatchObject({ botPaused: true, pausedBy: 'user_1' });
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

describe('pausa del bot al responder / tomar / devolver', () => {
  const metaWrites = () =>
    m(prisma.conversation.update).mock.calls.map((c) => c[0].data.metadata).filter(Boolean) as Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.conversation.findFirst).mockResolvedValue(waConversation);
    m(prisma.conversation.update).mockImplementation(async ({ data }: { data: { metadata?: unknown } }) => ({ metadata: data.metadata }));
    m(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    m(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    m(prisma.conversation.findUnique).mockResolvedValue({ metadata: null });
    m(prisma.user.findFirst).mockResolvedValue({ name: 'Ana Agente' });
    m(prisma.business.findFirst).mockResolvedValue({ whatsappNumber: '+14155550100', phone: null });
    m(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data }));
    m(prisma.message.update).mockImplementation(async ({ data }: { data: { metadata: unknown } }) => ({ metadata: data.metadata }));
    m(sendWhatsApp).mockResolvedValue('SM1');
  });

  it('/reply pausa el bot y guarda quién y cuándo', async () => {
    const res = await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(res.status).toBe(200);
    expect(metaWrites()[0]).toMatchObject({ botPaused: true, pausedBy: 'user_1', pausedByName: 'Ana Agente' });
    expect(typeof metaWrites()[0].pausedAt).toBe('string');
  });

  it('/reply no pisa quién había tomado la conversación', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({
      metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Otro agente', pausedAt: '2026-01-01T00:00:00.000Z', tags: ['vip'] },
    });

    await post('/api/conversations/c1/reply', { text: 'Hola' });

    expect(metaWrites()[0]).toMatchObject({ botPaused: true, pausedBy: 'user_9', pausedByName: 'Otro agente', tags: ['vip'] });
  });

  it('si falla la transición de atención no se guarda ni se envía nada (500) y se libera la clave', async () => {
    m(prisma.$transaction).mockRejectedValue(new Error('db caída'));
    m(claimIdempotentKey).mockResolvedValue(true);

    const res = await post('/api/conversations/c1/reply', { text: 'Hola' }, { 'Idempotency-Key': 'k-9' });

    expect(res.status).toBe(500);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(releaseIdempotentKey).toHaveBeenCalledWith(prisma, 'biz_1', expect.any(String), 'conv-reply:c1:k-9');
  });

  it('/take pausa el bot de esa conversación', async () => {
    const res = await post('/api/conversations/c1/take');

    expect(res.status).toBe(200);
    expect(res.body.metadata).toMatchObject({ botPaused: true, pausedBy: 'user_1', pausedByName: 'Ana Agente' });
  });

  it('/release devuelve la conversación al bot (OPEN) y limpia todo el rastro de atención', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({
      status: 'OPEN',
      metadata: { botPaused: true, pausedBy: 'user_1', pausedByName: 'Ana Agente', pausedAt: '2026-01-01T00:00:00.000Z', lastHumanAt: '2026-01-01T00:00:00.000Z', tags: ['vip'] },
    });

    const res = await post('/api/conversations/c1/release');

    expect(res.status).toBe(200);
    expect(res.body.metadata).toEqual({ tags: ['vip'] });
    expect(res.body.status).toBe('OPEN');
  });

  it('multi-tenant: /take y /release de una conversación ajena dan 404 sin escribir; el lock se scopea por negocio', async () => {
    m(prisma.$queryRaw).mockResolvedValue([]); // no existe para biz_1

    const take = await post('/api/conversations/c_ajena/take');
    const release = await post('/api/conversations/c_ajena/release');

    expect(take.status).toBe(404);
    expect(release.status).toBe(404);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    // $queryRaw es un template tag: (strings, id, businessId)
    expect(m(prisma.$queryRaw).mock.calls[0].slice(1)).toEqual(['c_ajena', 'biz_1']);
  });

  it('multi-tenant: /reply a una conversación ajena no pausa nada', async () => {
    m(prisma.conversation.findFirst).mockResolvedValue(null);

    const res = await post('/api/conversations/c_ajena/reply', { text: 'Hola' });

    expect(res.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe('atención: /take, /close y reintentos (estados atómicos)', () => {
  const proToken = jwt.sign({ userId: 'user_2', businessId: 'biz_1', role: 'PROFESSIONAL' }, JWT_SECRET);
  const proAuth = { Authorization: `Bearer ${proToken}` };
  const lastUpdate = () => m(prisma.conversation.update).mock.calls.at(-1)?.[0].data;
  const closeReq = (id: string) =>
    request(buildApp()).patch(`/api/conversations/${id}/close`).set('Authorization', `Bearer ${token}`);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    m(prisma.conversation.findFirst).mockResolvedValue(waConversation);
    m(prisma.conversation.update).mockImplementation(async ({ data }: { data: { status?: string; metadata?: unknown } }) => ({ status: data.status ?? 'OPEN', metadata: data.metadata }));
    m(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    m(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: null });
    m(prisma.user.findFirst).mockResolvedValue({ name: 'Ana Agente' });
    m(prisma.business.findFirst).mockResolvedValue({ whatsappNumber: '+14155550100', phone: null });
    m(sendWhatsApp).mockResolvedValue('SM1');
  });

  describe('/take', () => {
    it('saca la conversación de HANDOFF ("Te necesitan") y la deja OPEN + botPaused en la misma escritura', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({ status: 'HANDOFF', metadata: { waitingSince: '2026-01-01T00:00:00.000Z', handoffAckAt: '2026-01-01T00:00:00.000Z' } });

      const res = await post('/api/conversations/c1/take');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OPEN');
      expect(lastUpdate().status).toBe('OPEN');
      expect(res.body.metadata).toMatchObject({ botPaused: true, pausedBy: 'user_1' });
      expect(res.body.metadata.waitingSince).toBeUndefined();
      expect(res.body.metadata.handoffAckAt).toBeUndefined();
    });

    it('si ya la tiene OTRO agente responde 409 TAKEN_BY_OTHER y no escribe', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto' } });

      const res = await post('/api/conversations/c1/take');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAKEN_BY_OTHER');
      expect(res.body.takenBy).toEqual({ id: 'user_9', name: 'Beto' });
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('?force=true de un ADMIN le saca la conversación al otro agente', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto' } });

      const res = await post('/api/conversations/c1/take?force=true');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toMatchObject({ pausedBy: 'user_1' });
    });

    it('?force=true de un NO admin se ignora (409)', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto' } });

      const res = await post('/api/conversations/c1/take?force=true', {}, proAuth);

      expect(res.status).toBe(409);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('tomar una conversación CERRADA da 409', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({ status: 'CLOSED', metadata: null });

      const res = await post('/api/conversations/c1/take');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONVERSATION_CLOSED');
    });
  });

  describe('/reply conserva al primero que la tomó', () => {
    it('otro agente que responde no cambia pausedBy pero sí refresca lastHumanAt', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({
        status: 'OPEN',
        metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto', pausedAt: '2026-01-01T00:00:00.000Z', lastHumanAt: '2026-01-01T00:00:00.000Z' },
      });
      m(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', createdAt: new Date(), ...data }));
      m(prisma.message.update).mockResolvedValue({ metadata: {} });

      await post('/api/conversations/c1/reply', { text: 'Hola' });

      const meta = lastUpdate().metadata;
      expect(meta).toMatchObject({ pausedBy: 'user_9', pausedByName: 'Beto', pausedAt: '2026-01-01T00:00:00.000Z' });
      expect(Date.parse(meta.lastHumanAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
    });
  });

  describe('/close', () => {
    it('cierra una conversación HANDOFF (antes daba 404) y limpia botPaused/pausedBy/...', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({
        status: 'HANDOFF',
        metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto', pausedAt: 'x', lastHumanAt: 'x', waitingSince: 'x', tags: ['vip'] },
      });

      const res = await closeReq('c1');

      expect(res.status).toBe(200);
      const data = lastUpdate();
      expect(data.status).toBe('CLOSED');
      expect(data.metadata).toEqual({ tags: ['vip'] });
    });

    it('una conversación ya cerrada da 404 y no escribe', async () => {
      m(prisma.conversation.findUnique).mockResolvedValue({ status: 'CLOSED', metadata: null });

      const res = await closeReq('c1');

      expect(res.status).toBe(404);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('multi-tenant: una conversación ajena da 404', async () => {
      m(prisma.$queryRaw).mockResolvedValue([]);

      const res = await closeReq('c_ajena');

      expect(res.status).toBe(404);
      expect(m(prisma.$queryRaw).mock.calls[0].slice(1)).toEqual(['c_ajena', 'biz_1']);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('/retry de un pending colgado', () => {
    const humanMsg = (over: Record<string, unknown>) => ({
      id: 'm1', conversationId: 'c1', role: 'BOT', text: 'Hola', createdAt: new Date('2026-01-01T10:00:00Z'),
      metadata: { sender: 'human', userId: 'user_1', deliveryAttempts: 1, ...over },
    });

    beforeEach(() => {
      m(prisma.message.updateMany).mockResolvedValue({ count: 1 });
      m(prisma.message.update).mockImplementation(async ({ data }: { data: { metadata: unknown } }) => ({ metadata: data.metadata }));
    });

    it('un pending de más de 60 s se trata como failed y se reintenta', async () => {
      const old = new Date(Date.now() - 120_000).toISOString();
      m(prisma.message.findFirst).mockResolvedValue(humanMsg({ deliveryStatus: 'pending', deliveryStartedAt: old }));

      const res = await post('/api/conversations/c1/reply/m1/retry');

      expect(res.status).toBe(200);
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
      // La reserva atómica parte de 'pending' (no de 'failed').
      expect(m(prisma.message.updateMany).mock.calls[0][0].where.metadata).toEqual({ path: ['deliveryStatus'], equals: 'pending' });
    });

    it('un pending reciente (< 60 s) todavía se está enviando: 409 y no reenvía', async () => {
      m(prisma.message.findFirst).mockResolvedValue(humanMsg({ deliveryStatus: 'pending', deliveryStartedAt: new Date().toISOString() }));

      const res = await post('/api/conversations/c1/reply/m1/retry');

      expect(res.status).toBe(409);
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });

    it('sin deliveryStartedAt usa la fecha del mensaje para decidir si está colgado', async () => {
      m(prisma.message.findFirst).mockResolvedValue(humanMsg({ deliveryStatus: 'pending' })); // createdAt 2026-01-01: viejo

      const res = await post('/api/conversations/c1/reply/m1/retry');

      expect(res.status).toBe(200);
    });

    it('reintentar sobre una conversación CERRADA da 409', async () => {
      m(prisma.conversation.findFirst).mockResolvedValue({ ...waConversation, status: 'CLOSED' });

      const res = await post('/api/conversations/c1/reply/m1/retry');

      expect(res.status).toBe(409);
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });
  });
});
