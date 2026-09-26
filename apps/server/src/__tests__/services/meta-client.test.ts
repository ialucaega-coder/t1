/**
 * Tests del cliente de Meta (Instagram + Messenger): parseo de eventos del
 * webhook, validación de firma HMAC, resolución multi-tenant y Send API.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findMany: vi.fn() },
    bot: { findFirst: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  platformFromObject,
  connectionTypeFor,
  validateSignature,
  parseMetaEvents,
  resolveBusinessByRecipient,
  sendMessage,
} from '../../services/meta/client';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('platformFromObject / connectionTypeFor', () => {
  it('mapea el object del webhook a la plataforma', () => {
    expect(platformFromObject('instagram')).toBe('instagram');
    expect(platformFromObject('page')).toBe('messenger');
    expect(platformFromObject('otro')).toBeNull();
  });

  it('mapea la plataforma al tipo de Connection', () => {
    expect(connectionTypeFor('instagram')).toBe('INSTAGRAM');
    expect(connectionTypeFor('messenger')).toBe('MESSENGER');
  });
});

describe('validateSignature', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('valida una firma HMAC-SHA256 correcta', () => {
    process.env.META_APP_SECRET = 'secret123';
    const raw = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = 'sha256=' + crypto.createHmac('sha256', 'secret123').update(raw).digest('hex');
    expect(validateSignature(raw, sig)).toBe(true);
  });

  it('rechaza firma incorrecta, faltante o sin secret', () => {
    process.env.META_APP_SECRET = 'secret123';
    const raw = Buffer.from('{}');
    expect(validateSignature(raw, 'sha256=deadbeef')).toBe(false);
    expect(validateSignature(raw, undefined)).toBe(false);
    expect(validateSignature(raw, 'sinprefijo')).toBe(false);
    delete process.env.META_APP_SECRET;
    const sig = 'sha256=' + crypto.createHmac('sha256', 'secret123').update(raw).digest('hex');
    expect(validateSignature(raw, sig)).toBe(false);
  });
});

describe('parseMetaEvents', () => {
  it('parsea un mensaje de texto de Messenger', () => {
    const events = parseMetaEvents({
      object: 'page',
      entry: [{ id: 'PAGE_1', messaging: [{ sender: { id: 'USER_1' }, recipient: { id: 'PAGE_1' }, message: { text: 'hola' } }] }],
    });
    expect(events).toEqual([
      { platform: 'messenger', recipientId: 'PAGE_1', senderId: 'USER_1', text: 'hola', images: [] },
    ]);
  });

  it('parsea un mensaje de Instagram con imagen adjunta', () => {
    const events = parseMetaEvents({
      object: 'instagram',
      entry: [{
        id: 'IG_1',
        messaging: [{
          sender: { id: 'U9' }, recipient: { id: 'IG_1' },
          message: { attachments: [{ type: 'image', payload: { url: 'https://cdn.meta/img.jpg' } }] },
        }],
      }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].platform).toBe('instagram');
    expect(events[0].images).toEqual([{ url: 'https://cdn.meta/img.jpg' }]);
  });

  it('ignora echoes, eventos sin contenido y objects desconocidos', () => {
    expect(parseMetaEvents({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    const echo = parseMetaEvents({
      object: 'page',
      entry: [{ id: 'P', messaging: [{ sender: { id: 'P' }, recipient: { id: 'U' }, message: { text: 'x', is_echo: true } }] }],
    });
    expect(echo).toEqual([]);
    const readReceipt = parseMetaEvents({
      object: 'page',
      entry: [{ id: 'P', messaging: [{ sender: { id: 'U' }, recipient: { id: 'P' }, read: { watermark: 1 } }] }],
    });
    expect(readReceipt).toEqual([]);
  });

  it('corta en 4 imágenes por mensaje', () => {
    const attachments = Array.from({ length: 6 }, (_, i) => ({ type: 'image', payload: { url: `https://cdn/${i}.jpg` } }));
    const events = parseMetaEvents({
      object: 'instagram',
      entry: [{ id: 'IG', messaging: [{ sender: { id: 'U' }, recipient: { id: 'IG' }, message: { attachments } }] }],
    });
    expect(events[0].images).toHaveLength(4);
  });
});

describe('resolveBusinessByRecipient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resuelve el negocio por igId y usa el botId de la config', async () => {
    mock(prisma.connection.findMany).mockResolvedValue([
      { businessId: 'biz_1', config: { igId: 'IG_1', pageAccessToken: 'tok', botId: 'bot_1' } },
    ]);
    const target = await resolveBusinessByRecipient('instagram', 'IG_1');
    expect(target).toEqual({ businessId: 'biz_1', botId: 'bot_1', pageAccessToken: 'tok' });
    expect(mock(prisma.bot.findFirst)).not.toHaveBeenCalled();
  });

  it('cae al bot activo del canal si la config no trae botId', async () => {
    mock(prisma.connection.findMany).mockResolvedValue([
      { businessId: 'biz_1', config: { pageId: 'PAGE_1', pageAccessToken: 'tok' } },
    ]);
    mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_fallback' });
    const target = await resolveBusinessByRecipient('messenger', 'PAGE_1');
    expect(target?.botId).toBe('bot_fallback');
  });

  it('devuelve null si ninguna conexión coincide', async () => {
    mock(prisma.connection.findMany).mockResolvedValue([
      { businessId: 'biz_1', config: { pageId: 'OTRA' } },
    ]);
    expect(await resolveBusinessByRecipient('messenger', 'PAGE_1')).toBeNull();
  });

  it('devuelve null si coincide pero falta el token', async () => {
    mock(prisma.connection.findMany).mockResolvedValue([
      { businessId: 'biz_1', config: { pageId: 'PAGE_1' } },
    ]);
    expect(await resolveBusinessByRecipient('messenger', 'PAGE_1')).toBeNull();
  });
});

describe('sendMessage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('postea a la Send API con el token y el destinatario', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await sendMessage('PAGE_TOKEN', 'USER_9', 'hola!');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/me/messages?access_token=PAGE_TOKEN');
    const payload = JSON.parse(opts.body);
    expect(payload).toEqual({ recipient: { id: 'USER_9' }, message: { text: 'hola!' }, messaging_type: 'RESPONSE' });
  });

  it('lanza si Meta responde con error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendMessage('t', 'u', 'x')).rejects.toThrow(/400/);
  });
});
