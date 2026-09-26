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
    notification: { create: vi.fn() },
  },
}));

vi.mock('../../lib/socket', () => ({ getIO: vi.fn(() => null) }));
vi.mock('../../services/ai/engine', () => ({ getAIProviderForBusiness: vi.fn() }));
vi.mock('../../services/brand/config', () => ({
  loadBrandVoice: vi.fn(async () => null),
  buildBrandVoicePrompt: vi.fn(() => ''),
}));

import { prisma } from '../../lib/prisma';
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
