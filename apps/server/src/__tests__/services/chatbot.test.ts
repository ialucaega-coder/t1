/**
 * Pruebas del servicio de chatbot (`src/services/chatbot.ts`) enfocadas en la
 * persistencia del canal real en Conversation.metadata cuando el canal no tiene
 * enum propio en BotChannel (MESSENGER y VOICE se guardan como WEBCHAT).
 *
 * Se mockea Prisma, `lib/socket` (getIO → null), el motor de IA y la Voz de
 * Marca. Usamos un mensaje con intención CATALOG para evitar la llamada a la IA.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    bot: { findFirst: vi.fn(), create: vi.fn() },
    message: { create: vi.fn(), findMany: vi.fn() },
    service: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    skill: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    business: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('../../lib/socket', () => ({ getIO: vi.fn(() => null) }));
vi.mock('../../services/ai/engine', () => ({ getAIProviderForBusiness: vi.fn() }));
vi.mock('../../services/brand/config', () => ({
  loadBrandVoice: vi.fn(async () => null),
  buildBrandVoicePrompt: vi.fn(() => ''),
}));
vi.mock('../../services/faq/config', () => ({
  loadFaqItems: vi.fn(async () => []),
  buildFaqPrompt: vi.fn(() => ''),
}));
vi.mock('../../services/ai/system-prompt', () => ({
  loadSystemPrompt: vi.fn(async () => ''),
}));
vi.mock('../../services/billing/quota', () => ({
  getMessageQuota: vi.fn(async () => ({ used: 0, limit: 500, remaining: 500, overQuota: false, periodStart: '', periodEnd: null, plan: null })),
}));

import { prisma } from '../../lib/prisma';
import { getAIProviderForBusiness } from '../../services/ai/engine';
import { getMessageQuota } from '../../services/billing/quota';
import { processMessage, type ChatChannel } from '../../services/chatbot';

const mock = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Devuelve el `data` con el que se llamó a prisma.conversation.create. */
function createData(): Record<string, unknown> {
  return mock(prisma.conversation.create).mock.calls[0][0].data;
}

describe('services/chatbot — canal real en metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.conversation.update).mockResolvedValue({ id: 'c1' });
    mock(prisma.message.create).mockResolvedValue({ id: 'm1' });
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
  });

  // "precio" dispara la intención CATALOG (sin llamada a la IA).
  const run = (channel: ChatChannel) =>
    processMessage('biz_1', 'precio', channel, { history: [], botId: 'bot_1' });

  it('MESSENGER: persiste channel=WEBCHAT y metadata.realChannel=MESSENGER', async () => {
    await run('MESSENGER');
    const data = createData();
    expect(data.channel).toBe('WEBCHAT');
    expect(data.metadata).toEqual({ realChannel: 'MESSENGER' });
  });

  it('VOICE: persiste channel=WEBCHAT y metadata.realChannel=VOICE', async () => {
    await run('VOICE');
    const data = createData();
    expect(data.channel).toBe('WEBCHAT');
    expect(data.metadata).toEqual({ realChannel: 'VOICE' });
  });

  it('WEB: no agrega metadata (channel WEBCHAT alcanza)', async () => {
    await run('WEB');
    const data = createData();
    expect(data.channel).toBe('WEBCHAT');
    expect(data.metadata).toBeUndefined();
  });

  it('INSTAGRAM: usa su enum propio y no fuerza metadata.realChannel', async () => {
    await run('INSTAGRAM');
    const data = createData();
    expect(data.channel).toBe('INSTAGRAM');
    expect(data.metadata).toBeUndefined();
  });
});

describe('services/chatbot — scoping del nombre de cliente (anti IDOR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.conversation.update).mockResolvedValue({ id: 'c1' });
    mock(prisma.message.create).mockResolvedValue({ id: 'm1' });
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(prisma.business.findUnique).mockResolvedValue({ name: 'Barbería' });
    mock(getAIProviderForBusiness).mockResolvedValue({
      generateResponse: vi.fn().mockResolvedValue('respuesta del bot'),
    });
  });

  it('busca el nombre del cliente scopeado por businessId, no solo por id', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ name: 'Ana' });

    // Mensaje neutro (no dispara CATALOG) + clientId → ruta IA con lookup de nombre.
    await processMessage('biz_1', 'hola, ¿cómo estás?', 'WEB', {
      history: [],
      botId: 'bot_1',
      clientId: 'user_de_otro_negocio',
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user_de_otro_negocio', businessId: 'biz_1' } })
    );
    // Nunca por id sin scope (patrón IDOR).
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('services/chatbot — enforcement del cupo mensual del plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.conversation.update).mockResolvedValue({ id: 'c1' });
    mock(prisma.message.create).mockResolvedValue({ id: 'm1' });
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
  });

  it('sobre el cupo: NO llama al LLM y responde el mensaje de límite', async () => {
    mock(getMessageQuota).mockResolvedValueOnce({
      used: 500, limit: 500, remaining: 0, overQuota: true, periodStart: '', periodEnd: null, plan: 'Free',
    });
    const providerSpy = vi.fn();
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse: providerSpy });

    const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { history: [], botId: 'bot_1' });

    expect(getAIProviderForBusiness).not.toHaveBeenCalled();
    expect(providerSpy).not.toHaveBeenCalled();
    expect(res.text).toContain('límite de mensajes de su plan');
  });

  it('dentro del cupo: llama al LLM normalmente', async () => {
    mock(getMessageQuota).mockResolvedValueOnce({
      used: 10, limit: 500, remaining: 490, overQuota: false, periodStart: '', periodEnd: null, plan: 'Free',
    });
    mock(getAIProviderForBusiness).mockResolvedValue({
      generateResponse: vi.fn().mockResolvedValue('respuesta del bot'),
    });

    const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { history: [], botId: 'bot_1' });

    expect(getAIProviderForBusiness).toHaveBeenCalled();
    expect(res.text).toBe('respuesta del bot');
  });

  it('si el cupo falla al consultarse, degrada fail-open (el bot responde)', async () => {
    mock(getMessageQuota).mockRejectedValueOnce(new Error('db down'));
    mock(getAIProviderForBusiness).mockResolvedValue({
      generateResponse: vi.fn().mockResolvedValue('respuesta igual'),
    });

    const res = await processMessage('biz_1', 'hola', 'WEB', { history: [], botId: 'bot_1' });

    expect(getAIProviderForBusiness).toHaveBeenCalled();
    expect(res.text).toBe('respuesta igual');
  });
});

describe('services/chatbot — persistencia del consumo (FinOps)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.conversation.update).mockResolvedValue({ id: 'c1' });
    mock(prisma.message.create).mockResolvedValue({ id: 'm1' });
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(getMessageQuota).mockResolvedValue({
      used: 0, limit: 500, remaining: 500, overQuota: false, periodStart: '', periodEnd: null, plan: null,
    });
  });

  it('guarda el usage del provider en message.metadata y la latencia en responseTime', async () => {
    mock(getAIProviderForBusiness).mockResolvedValue({
      generateResponse: vi.fn(async (_msg: string, ctx: { recordUsage?: (u: unknown) => void }) => {
        ctx.recordUsage?.({ inputTokens: 100, outputTokens: 50, model: 'gpt-4o', provider: 'openai' });
        return 'ok';
      }),
    });

    await processMessage('biz_1', 'contame algo', 'WEB', { history: [], botId: 'bot_1' });

    // El primer message.create es el del usuario; el del bot lleva el usage.
    const botCall = mock(prisma.message.create).mock.calls.find((c) => c[0].data.role === 'BOT');
    const data = botCall![0].data;
    expect(data.metadata).toEqual({ usage: { inputTokens: 100, outputTokens: 50, model: 'gpt-4o', provider: 'openai' } });
    expect(typeof data.responseTime).toBe('number');
  });

  it('sin usage (provider no lo reporta): no escribe metadata ni responseTime basura', async () => {
    mock(getAIProviderForBusiness).mockResolvedValue({
      generateResponse: vi.fn().mockResolvedValue('ok'), // no llama recordUsage
    });

    await processMessage('biz_1', 'contame algo', 'WEB', { history: [], botId: 'bot_1' });

    const botCall = mock(prisma.message.create).mock.calls.find((c) => c[0].data.role === 'BOT');
    const data = botCall![0].data;
    expect(data.metadata).toBeUndefined();
    // responseTime sí se setea (latencia real), pero nunca usage.
    expect(data.responseTime === undefined || typeof data.responseTime === 'number').toBe(true);
  });
});
