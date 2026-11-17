/**
 * Polling del chat público (routes/publicChat.ts):
 *  - POST /chat emite un token de lectura al abrir una conversación (solo su hash
 *    queda en Conversation.metadata).
 *  - GET /chat/:botId/messages lo exige y devuelve solo campos públicos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const tx = {
  $queryRaw: vi.fn(),
  conversation: { findUnique: vi.fn(), update: vi.fn() },
};

vi.mock('../../lib/prisma', () => ({
  prisma: {
    bot: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn() },
    message: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('../../services/chatbot', () => ({ processMessage: vi.fn() }));
vi.mock('../../lib/socket', () => ({ getIO: vi.fn(() => null) }));
vi.mock('../../services/whatsapp/client', () => ({ isConfigured: vi.fn(() => false), sendMessage: vi.fn() }));
vi.mock('../../lib/otp', () => ({
  issueOtp: vi.fn(),
  verifyOtp: vi.fn(),
  publicBookingRequiresOtp: vi.fn(() => false),
}));
vi.mock('../../lib/sharedState', () => ({
  sharedIncr: vi.fn(async () => 1),
  sharedGet: vi.fn(),
  sharedSet: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { processMessage } from '../../services/chatbot';
import { sharedIncr } from '../../lib/sharedState';
import { publicChatRouter } from '../../routes/publicChat';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicChatRouter);
  app.use(errorHandler);
  return app;
}
const app = buildApp();

const TOKEN = 'tok_' + 'a'.repeat(40);
const OTHER_TOKEN = 'tok_' + 'b'.repeat(40);
const BOT = { id: 'bot1', status: 'ACTIVE', businessId: 'biz1' };
const url = (q: Record<string, string>, botId = 'bot1') =>
  `/api/public/chat/${botId}/messages?` + new URLSearchParams(q).toString();

beforeEach(() => {
  vi.clearAllMocks();
  mock(sharedIncr).mockResolvedValue(1);
  mock(prisma.bot.findUnique).mockResolvedValue(BOT);
  mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: { chatTokenHash: sha(TOKEN), tags: ['x'] } });
  mock(prisma.message.findMany).mockResolvedValue([]);
});

describe('GET /api/public/chat/:botId/messages', () => {
  it('con token válido devuelve SOLO los campos públicos (nunca metadata interna)', async () => {
    mock(prisma.message.findMany).mockResolvedValue([
      {
        id: 'm1', role: 'BOT', text: 'Hola, soy Ana del equipo', createdAt: new Date('2026-11-01T10:00:00.000Z'),
        metadata: { sender: 'human', userId: 'u1', userName: 'Ana', deliveryStatus: 'failed', deliveryError: 'boom' },
      },
      {
        id: 'm2', role: 'BOT', text: 'respuesta del bot', createdAt: new Date('2026-11-01T10:00:05.000Z'),
        metadata: { usage: { tokens: 10 } },
      },
    ]);

    const res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      { id: 'm1', role: 'BOT', text: 'Hola, soy Ana del equipo', createdAt: '2026-11-01T10:00:00.000Z', fromHuman: true },
      { id: 'm2', role: 'BOT', text: 'respuesta del bot', createdAt: '2026-11-01T10:00:05.000Z', fromHuman: false },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/userId|deliveryError|usage|chatTokenHash/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('acepta el token por el header X-Chat-Token (preferido) sin query', async () => {
    const res = await request(app)
      .get('/api/public/chat/bot1/messages?conversationId=c1')
      .set('X-Chat-Token', TOKEN);

    expect(res.status).toBe(200);
  });

  it('el header manda sobre la query; un header con token inválido no se rescata con la query válida', async () => {
    const res = await request(app)
      .get(url({ conversationId: 'c1', token: TOKEN }))
      .set('X-Chat-Token', OTHER_TOKEN);

    expect(res.status).toBe(404);
  });

  it('sin token (ni header ni query) devuelve el 404 genérico', async () => {
    const res = await request(app).get('/api/public/chat/bot1/messages?conversationId=c1');

    expect(res.status).toBe(404);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('la query sigue aceptándose por compatibilidad', async () => {
    const res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    expect(res.status).toBe(200);
  });

  it('solo consulta mensajes BOT de ESA conversación y con tope de 50', async () => {
    await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    const args = mock(prisma.message.findMany).mock.calls[0][0];
    expect(args.where).toMatchObject({ conversationId: 'c1', role: 'BOT' });
    expect(args.take).toBe(50);
  });

  it('valida que la conversación sea del bot y del negocio del :botId', async () => {
    await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', botId: 'bot1', businessId: 'biz1' } }),
    );
  });

  it('token inválido, de otra conversación, sin token guardado, otro bot o bot inactivo: mismo 404 genérico', async () => {
    const bodies: unknown[] = [];

    // token equivocado
    let res = await request(app).get(url({ conversationId: 'c1', token: OTHER_TOKEN }));
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // token de OTRA conversación (la conv c2 tiene el hash de OTHER_TOKEN)
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: { chatTokenHash: sha(OTHER_TOKEN) } });
    res = await request(app).get(url({ conversationId: 'c2', token: TOKEN }));
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // conversación legacy sin hash
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: {} });
    res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // la conversación no es de ese bot (el where con botId no la encuentra)
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }, 'otro-bot'));
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // bot inexistente / inactivo
    mock(prisma.bot.findUnique).mockResolvedValue({ ...BOT, status: 'PAUSED' });
    res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));
    expect(res.status).toBe(404);
    bodies.push(res.body);
    mock(prisma.bot.findUnique).mockResolvedValue(null);
    res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));
    expect(res.status).toBe(404);
    bodies.push(res.body);

    // no se puede distinguir un caso de otro (sin enumeración) y nada se leyó
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('parámetros mal formados dan 400 sin tocar la base', async () => {
    let res = await request(app).get(url({ conversationId: 'c1; DROP', token: TOKEN }));
    expect(res.status).toBe(400);
    res = await request(app).get(url({ conversationId: 'c1', token: 'corto' }));
    expect(res.status).toBe(400);
    expect(prisma.bot.findUnique).not.toHaveBeenCalled();
  });

  it('rate limit por IP: al pasarse devuelve 429 con Retry-After y no consulta la base', async () => {
    mock(sharedIncr).mockResolvedValueOnce(61);

    const res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(prisma.bot.findUnique).not.toHaveBeenCalled();
  });

  it('rate limit por conversación (solo con token válido): 429', async () => {
    mock(sharedIncr).mockResolvedValueOnce(1).mockResolvedValueOnce(31);

    const res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    expect(res.status).toBe(429);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('quien no tiene el token no gasta el cupo de la conversación', async () => {
    await request(app).get(url({ conversationId: 'c1', token: OTHER_TOKEN }));

    const keys = mock(sharedIncr).mock.calls.map((c) => String(c[0]));
    expect(keys.some((k) => k.includes('conv:'))).toBe(false);
  });

  it('paginación: after ISO trae solo mensajes posteriores', async () => {
    await request(app).get(url({ conversationId: 'c1', token: TOKEN, after: '2026-11-01T10:00:00.000Z' }));

    expect(mock(prisma.message.findMany).mock.calls[0][0].where).toMatchObject({
      createdAt: { gt: new Date('2026-11-01T10:00:00.000Z') },
    });
  });

  it('paginación: after por id de mensaje (de ESTA conversación) y 400 si no existe', async () => {
    mock(prisma.message.findFirst).mockResolvedValueOnce({ createdAt: new Date('2026-11-01T10:00:00.000Z') });
    let res = await request(app).get(url({ conversationId: 'c1', token: TOKEN, after: 'm1' }));
    expect(res.status).toBe(200);
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1', conversationId: 'c1' } }),
    );
    expect(mock(prisma.message.findMany).mock.calls[0][0].where.OR).toHaveLength(2);

    mock(prisma.message.findFirst).mockResolvedValueOnce(null);
    res = await request(app).get(url({ conversationId: 'c1', token: TOKEN, after: 'otro-id' }));
    expect(res.status).toBe(400);
  });

  it('hasMore avisa cuando se llegó al tope de 50', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`, role: 'BOT', text: 't', createdAt: new Date(2026, 10, 1, 10, 0, i), metadata: null,
    }));
    mock(prisma.message.findMany).mockResolvedValue(rows);

    const res = await request(app).get(url({ conversationId: 'c1', token: TOKEN }));

    expect(res.body.messages).toHaveLength(50);
    expect(res.body.hasMore).toBe(true);
  });
});

describe('POST /api/public/chat: token de lectura', () => {
  function setupNewConversation(existingMeta: Record<string, unknown> = {}) {
    mock(prisma.bot.findUnique).mockResolvedValue(BOT);
    mock(processMessage).mockResolvedValue({ text: 'hola', intent: 'FAQ', actions: [], conversationId: 'conv_new' });
    tx.$queryRaw.mockResolvedValue([{ id: 'conv_new' }]);
    tx.conversation.findUnique.mockResolvedValue({ metadata: existingMeta });
    tx.conversation.update.mockResolvedValue({});
  }

  beforeEach(() => {
    tx.$queryRaw.mockReset();
    tx.conversation.findUnique.mockReset();
    tx.conversation.update.mockReset();
  });

  it('en una conversación NUEVA devuelve el token y guarda solo su hash (sin pisar otra metadata)', async () => {
    setupNewConversation({ realChannel: 'VOICE' });

    const res = await request(app).post('/api/public/chat').send({ message: 'hola', botId: 'bot1' });

    expect(res.status).toBe(200);
    expect(res.body.chatToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const saved = tx.conversation.update.mock.calls[0][0].data.metadata as Record<string, unknown>;
    expect(saved.chatTokenHash).toBe(sha(res.body.chatToken));
    expect(saved.realChannel).toBe('VOICE');
    expect(JSON.stringify(saved)).not.toContain(res.body.chatToken);
  });

  it('continúa una conversación existente SOLO con su token válido (header) y no re-emite token', async () => {
    setupNewConversation();
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: { chatTokenHash: sha(TOKEN) } });
    mock(processMessage).mockResolvedValue({ text: 'hola', intent: 'FAQ', actions: [], conversationId: 'conv_old' });

    const res = await request(app)
      .post('/api/public/chat')
      .set('X-Chat-Token', TOKEN)
      .send({ message: 'hola', botId: 'bot1', conversationId: 'conv_old' });

    expect(res.status).toBe(200);
    expect(mock(processMessage).mock.calls[0][3].conversationId).toBe('conv_old');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv_old', botId: 'bot1', businessId: 'biz1' } }),
    );
    expect(res.body.chatToken).toBeUndefined();
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });

  it('también acepta el token en el body (compatibilidad)', async () => {
    setupNewConversation();
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: { chatTokenHash: sha(TOKEN) } });
    mock(processMessage).mockResolvedValue({ text: 'hola', intent: 'FAQ', actions: [], conversationId: 'conv_old' });

    await request(app)
      .post('/api/public/chat')
      .send({ message: 'hola', botId: 'bot1', conversationId: 'conv_old', chatToken: TOKEN });

    expect(mock(processMessage).mock.calls[0][3].conversationId).toBe('conv_old');
  });

  it('SIN token ignora el conversationId, abre una conversación NUEVA y no revela la ajena', async () => {
    setupNewConversation();
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: { chatTokenHash: sha(TOKEN) } });

    const res = await request(app)
      .post('/api/public/chat')
      .send({ message: 'hola', botId: 'bot1', conversationId: 'conv_ajena' });

    expect(mock(processMessage).mock.calls[0][3].conversationId).toBeUndefined();
    expect(res.body.conversationId).toBe('conv_new');
    expect(res.body.chatToken).toBeDefined(); // token de la conversación NUEVA, no de la ajena
    expect(JSON.stringify(res.body)).not.toContain('conv_ajena');
  });

  it('con el token de OTRA conversación también abre una nueva', async () => {
    setupNewConversation();
    // la conversación pedida tiene el hash de OTRO token
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: { chatTokenHash: sha(OTHER_TOKEN) } });

    await request(app)
      .post('/api/public/chat')
      .set('X-Chat-Token', TOKEN)
      .send({ message: 'hola', botId: 'bot1', conversationId: 'conv_ajena' });

    expect(mock(processMessage).mock.calls[0][3].conversationId).toBeUndefined();
  });

  it('una conversación de OTRO bot/negocio (no la encuentra el where) abre una nueva aunque el token sea válido', async () => {
    setupNewConversation();
    mock(prisma.conversation.findFirst).mockResolvedValue(null);

    await request(app)
      .post('/api/public/chat')
      .set('X-Chat-Token', TOKEN)
      .send({ message: 'hola', botId: 'bot1', conversationId: 'conv_de_otro_bot' });

    expect(mock(processMessage).mock.calls[0][3].conversationId).toBeUndefined();
  });

  it('un chat viejo (conversación sin hash) abre una conversación nueva', async () => {
    setupNewConversation();
    mock(prisma.conversation.findFirst).mockResolvedValue({ metadata: {} });

    await request(app)
      .post('/api/public/chat')
      .set('X-Chat-Token', TOKEN)
      .send({ message: 'hola', botId: 'bot1', conversationId: 'conv_vieja' });

    expect(mock(processMessage).mock.calls[0][3].conversationId).toBeUndefined();
  });

  it('nunca re-emite ni rota el token si la conversación ya tenía uno', async () => {
    setupNewConversation({ chatTokenHash: 'ya-existe' });

    const res = await request(app).post('/api/public/chat').send({ message: 'hola', botId: 'bot1' });

    expect(res.body.chatToken).toBeUndefined();
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });

  it('si no se puede guardar el token, el chat igual responde (sin polling)', async () => {
    setupNewConversation();
    tx.conversation.update.mockRejectedValue(new Error('db'));

    const res = await request(app).post('/api/public/chat').send({ message: 'hola', botId: 'bot1' });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('hola');
    expect(res.body.chatToken).toBeUndefined();
  });
});
