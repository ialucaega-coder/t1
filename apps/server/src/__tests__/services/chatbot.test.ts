/**
 * Pruebas del servicio de chatbot (`src/services/chatbot.ts`) enfocadas en la
 * persistencia del canal real en Conversation.metadata cuando el canal no tiene
 * enum propio en BotChannel (MESSENGER y VOICE se guardan como WEBCHAT).
 *
 * Se mockea Prisma, `lib/socket` (getIO → null), el motor de IA y la Voz de
 * Marca. Usamos un mensaje con intención CATALOG para evitar la llamada a la IA.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bot: { findFirst: vi.fn(), create: vi.fn() },
    message: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    professional: { count: vi.fn() },
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

// Por defecto la conversación está OPEN y sin pausa bajo el lock: el mensaje BOT se
// guarda dentro de una transacción con FOR UPDATE (la tx es el propio mock).
beforeEach(() => {
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
  mock(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: null });
});

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
  /** Filas que ve la transacción en lecturas sucesivas (la última se repite). */
  const dbRows = (...rows: { status: string; metadata: unknown }[]) => {
    const fn = mock(prisma.conversation.findUnique);
    fn.mockReset();
    rows.slice(0, -1).forEach((r) => fn.mockResolvedValueOnce({ status: r.status, metadata: r.metadata }));
    const last = rows[rows.length - 1];
    fn.mockResolvedValue({ status: last.status, metadata: last.metadata });
  };
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
      // No se vuelve a marcar el aviso (solo sube la fecha de la conversación).
      expect(writes().every((d) => d.metadata === undefined)).toBe(true);
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
      // 1ª lectura bajo lock (expire): vencida; 2ª (persistir la respuesta): ya liberada.
      dbRows(conv, { status: 'OPEN', metadata: {} });

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
      dbRows(conv, { status: 'OPEN', metadata: {} });

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
      // Lectura inicial: bot activo. Bajo el lock, justo antes de insertar: ya hay un humano.
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);
      dbRow(humanConv());

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(getAIProviderForBusiness).toHaveBeenCalled(); // la IA llegó a correr
      expect(res.botPaused).toBe(true);
      // Solo el mensaje del cliente; la respuesta del bot no se guardó.
      expect(mock(prisma.message.create).mock.calls.every((c) => c[0].data.role === 'USER')).toBe(true);
    });

    it('el chequeo y el insert del mensaje BOT van bajo FOR UPDATE de ESA conversación y negocio, en una transacción', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);

      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(prisma.$transaction).toHaveBeenCalled();
      // $queryRaw es un template tag: (strings, conversationId, businessId)
      expect(mock(prisma.$queryRaw).mock.calls[0].slice(1)).toEqual(['c1', 'biz_1']);
      expect(String(mock(prisma.$queryRaw).mock.calls[0][0].join(' '))).toMatch(/FOR UPDATE/);
      expect(mock(prisma.message.create).mock.calls.some((c) => c[0].data.role === 'BOT')).toBe(true);
    });

    it('también si en el medio la conversación pasó a HANDOFF', async () => {
      mock(prisma.conversation.findFirst).mockResolvedValue(botConv);
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

describe('services/chatbot — robustez entre guardar el USER y el BOT', () => {
  const botConv = { id: 'c1', businessId: 'biz_1', status: 'OPEN', metadata: null };
  const writes = () => mock(prisma.conversation.update).mock.calls.map((c) => c[0].data);
  const botMessages = () => mock(prisma.message.create).mock.calls.filter((c) => c[0].data.role === 'BOT');
  const userCreates = () => mock(prisma.message.create).mock.calls.filter((c) => c[0].data.role === 'USER');

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.findFirst).mockResolvedValue(botConv);
    mock(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: null });
    mock(prisma.conversation.update).mockImplementation(async ({ data }: { data: { status?: string; metadata?: unknown } }) => ({ status: data.status ?? 'OPEN', metadata: data.metadata }));
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    mock(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `m_${data.role}`, createdAt: new Date('2026-01-01T10:00:00Z'), ...data }));
    mock(prisma.message.findFirst).mockResolvedValue(null);
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'adm_1' }]);
    mock(prisma.notification.create).mockResolvedValue({});
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse: vi.fn().mockResolvedValue('respuesta del bot') });
  });

  describe('USER idempotente por externalId', () => {
    it('guarda el mensaje USER con el id de entrada en metadata.externalId', async () => {
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1', externalId: 'SM_1' });

      expect(userCreates()).toHaveLength(1);
      expect(userCreates()[0][0].data).toMatchObject({ text: 'hola, ¿tienen novedades?', metadata: { externalId: 'SM_1' } });
    });

    it('reintento: si el USER con ese externalId ya existe NO se vuelve a crear y se continúa (responde)', async () => {
      const existing = { id: 'm_old', role: 'USER', createdAt: new Date('2026-01-01T10:00:00Z') };
      // 1ª búsqueda (USER por externalId): existe. 2ª (BOT posterior): todavía no hay respuesta.
      mock(prisma.message.findFirst).mockResolvedValueOnce(existing).mockResolvedValue(null);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1', externalId: 'SM_1' });

      expect(mock(prisma.message.findFirst).mock.calls[0][0].where).toEqual({
        conversationId: 'c1', role: 'USER', metadata: { path: ['externalId'], equals: 'SM_1' },
      });
      expect(userCreates()).toHaveLength(0);
      expect(res.text).toBe('respuesta del bot');
      expect(botMessages()).toHaveLength(1);
    });

    it('reintento con el bot ya respondido: devuelve la respuesta guardada, sin volver a llamar a la IA ni duplicar', async () => {
      const existing = { id: 'm_old', role: 'USER', createdAt: new Date('2026-01-01T10:00:00Z') };
      mock(prisma.message.findFirst).mockResolvedValueOnce(existing).mockResolvedValueOnce({ text: 'ya respondí' });

      const res = await processMessage('biz_1', 'hola', 'WHATSAPP', { conversationId: 'c1', externalId: 'SM_1' });

      expect(res.text).toBe('ya respondí');
      expect(userCreates()).toHaveLength(0);
      expect(botMessages()).toHaveLength(0);
      expect(getAIProviderForBusiness).not.toHaveBeenCalled();
    });

    it('sin externalId (canal que no lo trae) se comporta como siempre: crea el USER sin metadata y no busca duplicados', async () => {
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { conversationId: 'c1' });

      expect(userCreates()).toHaveLength(1);
      expect(userCreates()[0][0].data.metadata).toBeUndefined();
      expect(prisma.message.findFirst).not.toHaveBeenCalled();
    });
  });

  it('si falla subir updatedAt DESPUÉS de guardar el BOT, el turno igual responde (no deja al cliente sin respuesta)', async () => {
    mock(prisma.conversation.update).mockRejectedValue(new Error('db caída'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

    expect(res.text).toBe('respuesta del bot');
    expect(botMessages()).toHaveLength(1);
    err.mockRestore();
  });

  describe('un mensaje USER sube la conversación en el Inbox aunque el bot esté callado', () => {
    it('HUMANO: se actualiza updatedAt', async () => {
      const conv = { id: 'c1', businessId: 'biz_1', status: 'OPEN', metadata: { botPaused: true, pausedBy: 'u1', lastHumanAt: new Date().toISOString(), pauseNoticeAt: new Date().toISOString() } };
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);

      const res = await processMessage('biz_1', 'hola?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      const bump = writes().find((d) => d.updatedAt instanceof Date);
      expect(bump).toBeTruthy();
      expect(botMessages()).toHaveLength(0);
    });

    it('ESPERANDO (HANDOFF): también', async () => {
      const conv = { id: 'c1', businessId: 'biz_1', status: 'HANDOFF', metadata: { waitingSince: new Date().toISOString(), pauseNoticeAt: new Date().toISOString() } };
      mock(prisma.conversation.findFirst).mockResolvedValue(conv);

      await processMessage('biz_1', 'hola?', 'WHATSAPP', { conversationId: 'c1' });

      expect(writes().some((d) => d.updatedAt instanceof Date)).toBe(true);
    });
  });

  describe('conversación CERRADA en el medio', () => {
    it('derivación: si se cerró, no acusa recibo, no avisa a los admins y no guarda BOT', async () => {
      // Lo que ve la transición de handoff bajo el lock: ya CLOSED.
      mock(prisma.conversation.findUnique).mockResolvedValue({ status: 'CLOSED', metadata: null });

      const res = await processMessage('biz_1', 'quiero hablar con una persona', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(res.text).toBe('');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(botMessages()).toHaveLength(0);
    });

    it('si se cerró mientras la IA generaba, la respuesta se descarta (no se guarda ni se envía)', async () => {
      mock(prisma.conversation.findUnique).mockResolvedValue({ status: 'CLOSED', metadata: null });

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(getAIProviderForBusiness).toHaveBeenCalled();
      expect(res.botPaused).toBe(true);
      expect(res.text).toBe('');
      expect(botMessages()).toHaveLength(0);
    });

    it('si la conversación ya no existe para el negocio (lock sin filas) tampoco se guarda el BOT', async () => {
      mock(prisma.$queryRaw).mockResolvedValue([]);

      const res = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { conversationId: 'c1' });

      expect(res.botPaused).toBe(true);
      expect(botMessages()).toHaveLength(0);
    });
  });
});


describe('services/chatbot — altas de conversación sin duplicados (advisory lock)', () => {
  const store: Array<Record<string, unknown>> = [];
  let lockTail: Promise<void> = Promise.resolve();

  beforeEach(() => {
    vi.clearAllMocks();
    store.length = 0;
    lockTail = Promise.resolve();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    // $transaction emula el advisory lock: serializa las transacciones (una por vez).
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => {
      const run = lockTail.then(() => cb(prisma));
      lockTail = run.then(() => undefined, () => undefined);
      return run;
    });
    mock(prisma.$executeRaw).mockResolvedValue(1);
    mock(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    // findFirst: busca en el "DB" en memoria por contacto (y devuelve null si no hay).
    mock(prisma.conversation.findFirst).mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      await new Promise((r) => setTimeout(r, 2)); // ventana de carrera entre lookup y alta
      // Aplana where + AND[...] en una sola lista de condiciones.
      const conds = [where, ...(((where.AND as Record<string, unknown>[]) ?? []))];
      const get = (k: string) => conds.map((c) => c[k]).find((v) => v !== undefined);
      const metaFilters = conds.map((c) => c.metadata as { path: string[]; equals: unknown } | undefined).filter(Boolean) as { path: string[]; equals: unknown }[];
      return store.find((c) => {
        if (c.businessId !== get('businessId')) return false;
        if (get('contactPhone') !== undefined && c.contactPhone !== get('contactPhone')) return false;
        const meta = (c.metadata ?? {}) as Record<string, unknown>;
        return metaFilters.every((f) => {
          const v = meta[f.path[0]];
          return f.equals === Prisma.AnyNull ? v === undefined : v === f.equals;
        });
      }) ?? null;
    });
    mock(prisma.conversation.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      await new Promise((r) => setTimeout(r, 2));
      const row = { id: `c_${store.length + 1}`, status: 'OPEN', ...data };
      store.push(row);
      return row;
    });
    mock(prisma.conversation.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) => store.find((c) => c.id === where.id) ?? null);
    mock(prisma.conversation.update).mockResolvedValue({});
    mock(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm', ...data }));
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse: vi.fn().mockResolvedValue('respuesta del bot') });
  });

  it('dos primeros mensajes simultáneos del mismo contacto crean UNA sola conversación', async () => {
    const opts = { botId: 'bot_1', contactPhone: '+549111' };

    const [a, b] = await Promise.all([
      processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', opts),
      processMessage('biz_1', 'hola de nuevo, ¿tienen novedades?', 'WHATSAPP', opts),
    ]);

    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
    expect(store).toHaveLength(1);
    expect(a.conversationId).toBe(b.conversationId);
  });

  it('el alta toma un advisory lock por (negocio, canal, contacto) y re-busca adentro', async () => {
    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { botId: 'bot_1', contactPhone: '+549111' });

    expect(prisma.$executeRaw).toHaveBeenCalled();
    const [, key] = mock(prisma.$executeRaw).mock.calls[0];
    expect(String(key)).toContain('conv-create:WHATSAPP:phone:+549111');
    expect(String(key)).toContain('biz_1');
    const where = mock(prisma.conversation.findFirst).mock.calls[0][0].where;
    expect(where).toMatchObject({ businessId: 'biz_1', status: { in: ['OPEN', 'HANDOFF'] } });
    expect(where.AND).toContainEqual({ contactPhone: '+549111' });
  });

  describe('no se mezclan canales que comparten el enum WEBCHAT (VOICE / MESSENGER / WEB)', () => {
    const phone = '+549333';

    it('una llamada (VOICE) NO se cuelga de una conversación WEBCHAT abierta del mismo teléfono', async () => {
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_1', contactPhone: phone });
      const voice = await processMessage('biz_1', 'hola, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', contactPhone: phone });

      expect(store).toHaveLength(2);
      expect(store[1]).toMatchObject({ metadata: { realChannel: 'VOICE' } });
      expect(voice.conversationId).toBe(store[1].id);
    });

    it('un chat WEB NO se cuelga de una conversación de VOZ abierta del mismo teléfono (sentido inverso)', async () => {
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', contactPhone: phone });
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_1', contactPhone: phone });

      expect(store).toHaveLength(2);
      expect(store[1].metadata).toBeUndefined();
    });

    it('MESSENGER y VOICE tampoco se mezclan entre sí', async () => {
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'MESSENGER', { botId: 'bot_1', contactPhone: phone });
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', contactPhone: phone });

      expect(store.map((c) => (c.metadata as { realChannel?: string }).realChannel)).toEqual(['MESSENGER', 'VOICE']);
    });

    it('el mismo canal SÍ se reutiliza: dos llamadas simultáneas del mismo teléfono quedan en una conversación', async () => {
      const [a, b] = await Promise.all([
        processMessage('biz_1', 'hola, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', contactPhone: phone }),
        processMessage('biz_1', 'sigo acá, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', contactPhone: phone }),
      ]);

      expect(store).toHaveLength(1);
      expect(a.conversationId).toBe(b.conversationId);
    });

    it('el filtro de realChannel viaja DENTRO del lock: VOICE exige el valor, WEB exige que esté ausente', async () => {
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', contactPhone: phone });
      await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_1', contactPhone: '+549444' });

      const voiceWhere = mock(prisma.conversation.findFirst).mock.calls[0][0].where;
      const webWhere = mock(prisma.conversation.findFirst).mock.calls[1][0].where;
      expect(voiceWhere.AND).toContainEqual({ metadata: { path: ['realChannel'], equals: 'VOICE' } });
      expect(webWhere.AND).toContainEqual({ metadata: { path: ['realChannel'], equals: Prisma.AnyNull } });
    });
  });

  it('contactos distintos NO se bloquean entre sí: crean una conversación cada uno', async () => {
    await Promise.all([
      processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { botId: 'bot_1', contactPhone: '+549111' }),
      processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { botId: 'bot_1', contactPhone: '+549222' }),
    ]);

    expect(store).toHaveLength(2);
  });

  it('el mismo teléfono en OTRO negocio es otra conversación (multi-tenant)', async () => {
    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { botId: 'bot_1', contactPhone: '+549111' });
    await processMessage('biz_2', 'hola, ¿tienen novedades?', 'WHATSAPP', { botId: 'bot_2', contactPhone: '+549111' });

    expect(store.map((c) => c.businessId)).toEqual(['biz_1', 'biz_2']);
  });

  it('dos altas simultáneas del mismo suscriptor (ManyChat) también quedan en una conversación', async () => {
    const [a, b] = await Promise.all([
      processMessage('biz_1', 'hola, ¿tienen novedades?', 'MESSENGER', { botId: 'bot_1', subscriberId: 'sub_1' }),
      processMessage('biz_1', 'otra vez, ¿tienen novedades?', 'MESSENGER', { botId: 'bot_1', subscriberId: 'sub_1' }),
    ]);

    expect(store).toHaveLength(1);
    expect(a.conversationId).toBe(b.conversationId);
  });

  it('sin identificador del contacto (widget anónimo) no hay lock y se crea directo', async () => {
    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_1' });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
  });
});

describe('services/chatbot — intención HUMAN exige una frase, no la palabra "persona" suelta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    mock(prisma.conversation.create).mockResolvedValue({ id: 'c_new', businessId: 'biz_1', status: 'OPEN', metadata: null });
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: null });
    mock(prisma.conversation.update).mockResolvedValue({});
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$queryRaw).mockResolvedValue([{ id: 'c_new' }]);
    mock(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm', ...data }));
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(prisma.user.findMany).mockResolvedValue([]);
    mock(prisma.professional.count).mockResolvedValue(1);
    mock(prisma.notification.create).mockResolvedValue({});
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse: vi.fn().mockResolvedValue('respuesta del bot') });
  });

  const intentOf = async (text: string) => (await processMessage('biz_1', text, 'WEB', { botId: 'bot_1' })).intent;

  it.each([
    'quiero un turno para 2 personas',
    'somos 3 personas, ¿tienen mesa?',
    'La persona que viene mañana es mi hermano',
  ])('"%s" NO deriva a un humano', async (text) => {
    expect(await intentOf(text)).not.toBe('HUMAN');
  });

  it('un turno para 2 personas sigue siendo BOOKING', async () => {
    expect(await intentOf('quiero un turno para 2 personas')).toBe('BOOKING');
  });

  it.each([
    'quiero hablar con una persona',
    'necesito hablar con una persona real',
    'pasame con una persona por favor',
    'quiero una persona que me atienda',
    'me atiende una persona de verdad?',
    'quiero hablar con un humano',
    'necesito un operador',
  ])('"%s" SÍ deriva a un humano', async (text) => {
    expect(await intentOf(text)).toBe('HUMAN');
  });
});


describe('services/chatbot — botId validado y prompt sin duplicados', () => {
  const botConvNew = (data: Record<string, unknown>) => ({ id: 'c_new', status: 'OPEN', metadata: null, ...data });

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    mock(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: null });
    mock(prisma.conversation.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => botConvNew(data));
    mock(prisma.conversation.update).mockResolvedValue({});
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$queryRaw).mockResolvedValue([{ id: 'c_new' }]);
    mock(prisma.message.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm', ...data }));
    mock(prisma.message.findMany).mockResolvedValue([]);
    mock(prisma.service.findMany).mockResolvedValue([]);
    mock(prisma.product.findMany).mockResolvedValue([]);
    mock(prisma.skill.findMany).mockResolvedValue([]);
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse: vi.fn().mockResolvedValue('respuesta del bot') });
  });

  it('un botId de OTRO negocio se ignora: la conversación se crea con el bot por defecto del propio negocio', async () => {
    // 1ª búsqueda (¿es mío ese botId?): no. 2ª (bot por defecto del negocio): bot_default.
    mock(prisma.bot.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'bot_default' });

    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_ajeno' });

    expect(mock(prisma.bot.findFirst).mock.calls[0][0].where).toEqual({ id: 'bot_ajeno', businessId: 'biz_1' });
    expect(mock(prisma.conversation.create).mock.calls[0][0].data).toMatchObject({ businessId: 'biz_1', botId: 'bot_default' });
  });

  it('un botId del propio negocio se respeta', async () => {
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_mio' });

    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_mio' });

    expect(mock(prisma.conversation.create).mock.calls[0][0].data.botId).toBe('bot_mio');
  });

  it('un botId ajeno tampoco se usa para buscar una conversación existente del contacto (no filtra por el bot ajeno)', async () => {
    mock(prisma.bot.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'bot_default' });
    mock(prisma.$executeRaw).mockResolvedValue(1);

    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WHATSAPP', { botId: 'bot_ajeno', contactPhone: '+549111' });

    const lookup = mock(prisma.conversation.findFirst).mock.calls[0][0].where;
    expect(lookup.botId).toBeUndefined();
  });

  it('sin botId usa el bot por defecto (no consulta si es propio)', async () => {
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_default' });

    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', {});

    expect(mock(prisma.bot.findFirst).mock.calls).toHaveLength(1);
    expect(mock(prisma.conversation.create).mock.calls[0][0].data.botId).toBe('bot_default');
  });

  it('systemPromptExtra llega UNA sola vez al prompt del proveedor (antes se duplicaba)', async () => {
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    const generateResponse = vi.fn().mockResolvedValue('respuesta del bot');
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse });

    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'VOICE', { botId: 'bot_1', systemPromptExtra: 'PERSONA-VOZ-UNICA' });

    const prompt = generateResponse.mock.calls[0][1].systemPrompt as string;
    expect(prompt.split('PERSONA-VOZ-UNICA')).toHaveLength(2); // exactamente una aparición
  });

  it('sin systemPromptExtra el prompt no cambia', async () => {
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1' });
    const generateResponse = vi.fn().mockResolvedValue('respuesta del bot');
    mock(getAIProviderForBusiness).mockResolvedValue({ generateResponse });

    await processMessage('biz_1', 'hola, ¿tienen novedades?', 'WEB', { botId: 'bot_1' });

    expect(generateResponse.mock.calls[0][1].systemPrompt).toContain('Todavía no hay servicios ni productos cargados');
  });
});
