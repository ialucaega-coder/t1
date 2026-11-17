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
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bot: { findFirst: vi.fn(), create: vi.fn() },
    message: { create: vi.fn(), findMany: vi.fn() },
    service: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    skill: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
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
// Stub del disparo de automatizaciones (se prueba aparte): evita la cadena real.
vi.mock('../../services/workflows', () => ({ dispatchEvent: vi.fn() }));

import { prisma } from '../../lib/prisma';
import { getAIProviderForBusiness } from '../../services/ai/engine';
import { getMessageQuota } from '../../services/billing/quota';
import { dispatchEvent } from '../../services/workflows';
import { processMessage, BOT_PAUSED_NOTICE, type ChatChannel } from '../../services/chatbot';

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

  it('dispara el trigger "mensaje_entrante" con el canal y la conversación', async () => {
    await run('WHATSAPP');
    expect(dispatchEvent).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ trigger: 'mensaje_entrante', payload: expect.objectContaining({ channel: 'WHATSAPP', conversationId: 'c1' }) }),
    );
  });

  it('CTWA: persiste la atribución en metadata.attribution al CREAR la conversación', async () => {
    const attribution = {
      source: 'ctwa' as const,
      sourceType: 'ad',
      sourceId: 'ad_123',
      headline: 'Oferta de verano',
      ctwaClid: 'clid_abc',
      at: '2026-10-20T00:00:00.000Z',
    };

    await processMessage('biz_1', 'precio', 'WHATSAPP', { history: [], botId: 'bot_1', attribution });

    const data = createData();
    expect(data.channel).toBe('WHATSAPP');
    const metadata = data.metadata as Record<string, unknown>;
    expect(metadata.attribution).toEqual(attribution);
  });

  it('sin atribución: no agrega metadata.attribution', async () => {
    await run('WHATSAPP');
    const data = createData();
    // WHATSAPP no genera realChannel ni subscriberId, así que metadata queda vacío/omitido.
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

describe('services/chatbot — bot silenciado (humano atendiendo / esperando agente)', () => {
  const MIN = 60_000;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const humanConv = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    businessId: 'biz_1',
    status: 'OPEN',
    metadata: { botPaused: true, pausedBy: 'user_1', pausedByName: 'Ana', pausedAt: ago(2 * MIN), lastHumanAt: ago(2 * MIN), ...over },
  });
  const waitingConv = (since = ago(2 * MIN), over: Record<string, unknown> = {}) => ({
    id: 'c1', businessId: 'biz_1', status: 'HANDOFF', metadata: { waitingSince: since, ...over },
  });
  const botConv = { id: 'c1', businessId: 'biz_1', status: 'OPEN', metadata: null };

  /** Lo que la transacción "ve" bajo el lock (findUnique) y devuelve al escribir. */
  const dbRow = (conv: { status: string; metadata: unknown }) => mock(prisma.conversation.findUnique).mockResolvedValue({ status: conv.status, metadata: conv.metadata });
  const writes = () => mock(prisma.conversation.update).mock.calls.map((c) => c[0].data);

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.create).mockResolvedValue({ id: 'c_new', businessId: 'biz_1', status: 'OPEN', metadata: null });
    mock(prisma.conversation.update).mockImplementation(async ({ data }: { data: { status?: string; metadata: unknown } }) => ({ status: data.status ?? 'OPEN', metadata: data.metadata }));
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    mock(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data }));
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'adm_1' }, { id: 'adm_2' }]);
    mock(prisma.notification.create).mockResolvedValue({});
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse: vi.fn().mockResolvedValue('respuesta del bot') });
  });

  describe('HUMANO (botPaused)', () => {
    it('guarda el mensaje del cliente pero NO llama a la IA, no cuenta cuota y no guarda respuesta del bot', async () => {
      const conv = humanConv();
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola, ¿siguen ahí?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(res.conversationId).toBe('c1');
      expect(res.actions).toEqual([]);
      expect(prisma.message.create).toHaveBeenCalledTimes(1);
      expect(mock(prisma.message.create).mock.calls[0][0].data).toMatchObject({ conversationId: 'c1', role: 'USER', text: 'hola, ¿siguen ahí?' });
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
      expect(getMessageQuota).not.toHaveBeenCalled();
    });

    it('el aviso de cortesía sale UNA vez y queda marcado; el siguiente mensaje (< 10 min) va sin texto', async () => {
      const conv = humanConv();
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const first = await processMessage('biz_1', 'hola', 'WEB', { conversationId: 'c1' });

      expect(first.text).toBe(BOT_PAUSED_NOTICE);
      const stamped = writes().find((d) => d.metadata?.pauseNoticeAt);
      expect(stamped).toBeTruthy();

      // Segundo mensaje: la conversación ya trae pauseNoticeAt reciente.
      const withNotice = humanConv({ pauseNoticeAt: ago(1 * MIN) });
      mock(prisma.conversation.findFirst).mockResolvedValue(withNotice);
      mock(prisma.conversation.update).mockClear();
      const second = await processMessage('biz_1', 'hola de nuevo', 'WEB', { conversationId: 'c1' });

      expect(second.botPaused).toBe(true);
      expect(second.text).toBe('');
      expect(prisma.conversation.update).not.toHaveBeenCalled();
      // Los dos mensajes del cliente se guardaron igual.
      expect(mock(prisma.message.create).mock.calls.filter((c) => c[0].data.role === 'USER')).toHaveLength(2);
    });

    it('pasados 10 min vuelve a avisar', async () => {
      const conv = humanConv({ pauseNoticeAt: ago(11 * MIN) });
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola', 'WEB', { conversationId: 'c1' });

      expect(res.text).toBe(BOT_PAUSED_NOTICE);
    });

    it('con botPaused liberado (devuelto al bot) responde con la IA como siempre', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBeUndefined();
      expect(res.text).toBe('respuesta del bot');
      expect(getAIProviderForBusiness).toHaveBeenCalled();
    });
  });

  describe('ESPERANDO (HANDOFF)', () => {
    it('una conversación HANDOFF silencia al bot (antes seguía contestando)', async () => {
      const conv = waitingConv();
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
      expect(mock(prisma.message.create).mock.calls.every((c) => c[0].data.role === 'USER')).toBe(true);
    });

    it('una HANDOFF de un suscriptor (ManyChat) se reusa en vez de abrir otra', async () => {
      const conv = waitingConv();
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola', 'MESSENGER', { subscriberId: 'sub_1' });

      expect(mock(prisma.conversation.findFirst).mock.calls[0][0].where).toMatchObject({ businessId: 'biz_1', status: { in: ['OPEN', 'HANDOFF'] } });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(res.conversationId).toBe('c1');
      expect(res.botPaused).toBe(true);
    });
  });

  describe('plazos (expire lazy)', () => {
    it('HUMANO sin actividad humana por más de 30 min vuelve al bot y este mensaje se responde normal', async () => {
      const conv = humanConv({ lastHumanAt: ago(31 * MIN), pausedAt: ago(40 * MIN) });
      // 1ª lectura: vencida. La relectura previa a persistir ya ve el estado liberado.
      mock(prisma.conversation.findFirst).mockResolvedValueOnce(conv).mockResolvedValue(botConv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      const expiry = writes()[0];
      expect(expiry.status).toBeUndefined(); // ya estaba OPEN
      expect(expiry.metadata.botPaused).toBeUndefined();
      expect(expiry.metadata.pausedBy).toBeUndefined();
      expect(res.botPaused).toBeUndefined();
      expect(res.text).toBe('respuesta del bot');
    });

    it('HUMANO con actividad hace 29 min sigue silenciado', async () => {
      const conv = humanConv({ lastHumanAt: ago(29 * MIN) });
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
    });

    it('ESPERANDO por más de 15 min sin que nadie tome: pasa a OPEN (bot) y responde', async () => {
      const conv = waitingConv(ago(16 * MIN));
      mock(prisma.conversation.findFirst).mockResolvedValueOnce(conv).mockResolvedValue(botConv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(writes()[0].status).toBe('OPEN');
      expect(res.botPaused).toBeUndefined();
      expect(res.text).toBe('respuesta del bot');
    });

    it('si un humano respondió justo antes de expirar, gana el humano (se re-evalúa bajo el lock)', async () => {
      // Lo leído al inicio estaba vencido, pero bajo el lock ya tiene actividad reciente.
      mock(prisma.conversation.findFirst).mockResolvedValue(humanConv({ lastHumanAt: ago(40 * MIN) }));
      dbRow(humanConv({ lastHumanAt: ago(10_000) }));

      const res = await processMessage('biz_1', 'hola', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
    });
  });

  describe('carrera: el humano entra mientras la IA genera', () => {
    it('si se pausó a mitad de la generación, la respuesta del bot se DESCARTA (no se guarda)', async () => {
      // 1ª lectura (getOrCreate): bot activo. Relectura justo antes de persistir: ya hay un humano.
      mock(prisma.conversation.findFirst)
        .mockResolvedValueOnce(botConv)
        .mockResolvedValueOnce(humanConv());
      dbRow(humanConv());

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(getAIProviderForBusiness).toHaveBeenCalled(); // la IA llegó a correr
      expect(res.botPaused).toBe(true);
      // Solo el mensaje del cliente; la respuesta del bot no se guardó.
      expect(mock(prisma.message.create).mock.calls.every((c) => c[0].data.role === 'USER')).toBe(true);
      // Y la relectura fue liviana y scopeada por negocio.
      const reread = mock(prisma.conversation.findFirst).mock.calls[1][0];
      expect(reread.where).toEqual({ id: 'c1', businessId: 'biz_1' });
      expect(reread.select).toEqual({ status: true, metadata: true });
    });

    it('también si en el medio la conversación pasó a HANDOFF', async () => {
      mock(prisma.conversation.findFirst)
        .mockResolvedValueOnce(botConv)
        .mockResolvedValueOnce(waitingConv());
      dbRow(waitingConv());

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(mock(prisma.message.create).mock.calls.every((c) => c[0].data.role === 'USER')).toBe(true);
    });

    it('sin humano en el medio la respuesta del bot se guarda normal', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.text).toBe('respuesta del bot');
      expect(mock(prisma.message.create).mock.calls.some((c) => c[0].data.role === 'BOT')).toBe(true);
    });
  });

  describe('derivación del propio bot (intención HUMAN)', () => {
    it('deriva en una transacción (HANDOFF + marcas), acusa recibo UNA vez y avisa a TODOS los admins activos', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);
      dbRow(botConv);

      const res = await processMessage('biz_1', 'quiero hablar con una persona', 'WHATSAPP', { conversationId: 'c1' });

      const handoff = writes()[0];
      expect(handoff.status).toBe('HANDOFF');
      expect(handoff.metadata.waitingSince).toBeTruthy();
      expect(handoff.metadata.handoffAckAt).toBeTruthy();
      // Un solo acuse: el mensaje BOT es el de la derivación.
      expect(res.text).toContain('en breve te va a contactar una persona');
      expect(res.botPaused).toBeUndefined();
      expect(res.actions[0].type).toBe('escalateToHuman');
      expect(mock(prisma.message.create).mock.calls.filter((c) => c[0].data.role === 'BOT')).toHaveLength(1);
      // Todos los admins activos de ESTE negocio.
      expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({ businessId: 'biz_1', role: 'ADMIN', isActive: true });
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
      expect(mock(prisma.notification.create).mock.calls.map((c) => c[0].data.userId).sort()).toEqual(['adm_1', 'adm_2']);
    });

    it('después de derivar, el siguiente mensaje del cliente NO repite el acuse (el bot queda callado)', async () => {
      const conv = waitingConv(ago(1 * MIN), { handoffAckAt: ago(1 * MIN) });
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);
      dbRow(conv);

      const res = await processMessage('biz_1', 'quiero hablar con una persona', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(res.text).not.toContain('en breve te va a contactar');
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mock(prisma.message.create).mock.calls.every((c) => c[0].data.role === 'USER')).toBe(true);
    });

    it('sin ADMIN activo no falla: loguea', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);
      dbRow(botConv);
      mock(prisma.user.findMany).mockResolvedValue([]);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await processMessage('biz_1', 'quiero hablar con una persona', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.text).toContain('en breve te va a contactar');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ADMIN activo'), expect.objectContaining({ businessId: 'biz_1' }));
      expect(prisma.notification.create).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('si un humano la tomó justo antes, no se pisa ni se acusa recibo', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv); // lectura inicial: BOT
      dbRow(humanConv()); // bajo el lock ya la tenía un humano

      const res = await processMessage('biz_1', 'quiero hablar con una persona', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(writes().every((d) => d.status === undefined)).toBe(true);
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(mock(prisma.message.create).mock.calls.every((c) => c[0].data.role === 'USER')).toBe(true);
    });
  });

  it('multi-tenant: la conversación de OTRO negocio no se encuentra y el bot responde normal en la propia', async () => {
    mock(prisma.conversation.findFirst).mockResolvedValue(null);

    const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { conversationId: 'c_de_biz_2' });

    expect(mock(prisma.conversation.findFirst).mock.calls[0][0].where).toEqual({
      id: 'c_de_biz_2', businessId: 'biz_1', status: { in: ['OPEN', 'HANDOFF'] },
    });
    expect(mock(prisma.conversation.create).mock.calls[0][0].data).toMatchObject({ businessId: 'biz_1' });
    expect(res.botPaused).toBeUndefined();
    expect(getAIProviderForBusiness).toHaveBeenCalled();
  });

  describe('conversationId explícito (widget)', () => {
    it('apunta a una conversación CLOSED: se abre una NUEVA con el bot activo', async () => {
      // La búsqueda filtra por estado activo, así que una CLOSED no se encuentra.
      mock(prisma.conversation.findFirst).mockResolvedValue(null);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { conversationId: 'c_cerrada' });

      expect(mock(prisma.conversation.findFirst).mock.calls[0][0].where).toMatchObject({ id: 'c_cerrada', status: { in: ['OPEN', 'HANDOFF'] } });
      expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
      expect(mock(prisma.message.create).mock.calls[0][0].data.conversationId).toBe('c_new');
      expect(res.conversationId).toBe('c_new');
      expect(res.botPaused).toBeUndefined();
      expect(getAIProviderForBusiness).toHaveBeenCalled();
    });

    it('apunta a una conversación OPEN: la reutiliza', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { conversationId: 'c1' });

      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(res.conversationId).toBe('c1');
    });

    it('apunta a una conversación de OTRO negocio: se abre una nueva en el propio', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(null);

      await processMessage('biz_1', 'hola', 'WEB', { conversationId: 'c_de_biz_2' });

      expect(mock(prisma.conversation.findFirst).mock.calls[0][0].where).toMatchObject({ businessId: 'biz_1' });
      expect(mock(prisma.conversation.create).mock.calls[0][0].data).toMatchObject({ businessId: 'biz_1' });
    });
  });
});
