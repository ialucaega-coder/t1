/**
 * Pruebas de `services/channels/deliver.ts`: la respuesta de un humano llega al
 * canal real de la conversación. Se mockean las primitivas de cada canal
 * (Twilio, Meta, ManyChat, grammy) y Prisma; no se hace ninguna llamada real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findFirst: vi.fn() },
    connection: { findFirst: vi.fn() },
  },
}));
vi.mock('../../lib/crypto', () => ({ safeDecrypt: vi.fn((v: string) => v.replace(/^enc:/, '')) }));
vi.mock('../../services/whatsapp/client', () => ({ sendMessage: vi.fn() }));
vi.mock('../../services/meta/client', () => ({ sendMessage: vi.fn() }));
vi.mock('../../services/manychat/config', () => ({ loadMcConfig: vi.fn() }));
vi.mock('../../services/manychat/client', () => ({ sendText: vi.fn() }));

const telegramSend = vi.fn();
const telegramCtor = vi.fn();
vi.mock('grammy', () => ({
  Api: class {
    constructor(token: string) {
      telegramCtor(token);
    }
    sendMessage = telegramSend;
  },
}));

import { prisma } from '../../lib/prisma';
import { sendMessage as sendWhatsApp } from '../../services/whatsapp/client';
import { sendMessage as sendMeta } from '../../services/meta/client';
import { loadMcConfig } from '../../services/manychat/config';
import { sendText as sendManychat } from '../../services/manychat/client';
import { deliverToChannel, type DeliverableConversation } from '../../services/channels/deliver';

const mock = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function conv(over: Partial<DeliverableConversation>): DeliverableConversation {
  return { id: 'c1', channel: 'WHATSAPP', contactPhone: '+5491155550000', metadata: null, ...over };
}

function connectionConfig(config: Record<string, unknown>) {
  mock(prisma.connection.findFirst).mockResolvedValue({ config });
}

describe('services/channels/deliver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.business.findFirst).mockResolvedValue({ whatsappNumber: '+14155550100', phone: null });
  });

  describe('WhatsApp', () => {
    it('envía por Twilio al contactPhone desde el número del negocio', async () => {
      mock(sendWhatsApp).mockResolvedValue('SM123');

      const res = await deliverToChannel(conv({}), 'Hola, soy una persona', 'biz_1');

      expect(sendWhatsApp).toHaveBeenCalledWith('+5491155550000', 'Hola, soy una persona', '+14155550100');
      expect(res).toEqual({ status: 'sent', providerMessageId: 'SM123' });
      // El negocio se busca SIEMPRE con el businessId recibido.
      expect(prisma.business.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'biz_1' } }));
    });

    it('fuera de la ventana de 24 h (Twilio 63016) devuelve un fallo legible y no inventa plantillas', async () => {
      mock(sendWhatsApp).mockRejectedValue(Object.assign(new Error('outside the allowed window'), { code: 63016 }));

      const res = await deliverToChannel(conv({}), 'Hola', 'biz_1');

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/24 h/);
      expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    });

    it('sin número propio cae al global (sin from) y deja un warn', async () => {
      mock(prisma.business.findFirst).mockResolvedValue({ whatsappNumber: null, phone: null });
      mock(sendWhatsApp).mockResolvedValue('SM1');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await deliverToChannel(conv({}), 'Hola', 'biz_1');

      expect(sendWhatsApp).toHaveBeenCalledWith('+5491155550000', 'Hola', undefined);
      expect(res.status).toBe('sent');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('número global'), { businessId: 'biz_1' });
      warn.mockRestore();
    });

    it('con número propio no loguea el warn del número global', async () => {
      mock(sendWhatsApp).mockResolvedValue('SM1');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await deliverToChannel(conv({}), 'Hola', 'biz_1');

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('sin teléfono no llama a Twilio y falla con motivo', async () => {
      const res = await deliverToChannel(conv({ contactPhone: null }), 'Hola', 'biz_1');

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/teléfono/);
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });
  });

  describe('Instagram', () => {
    it('envía por la Send API de Meta con el token descifrado de la Connection INSTAGRAM', async () => {
      connectionConfig({ pageAccessToken: 'enc:TOKEN_IG', igId: 'IG1' });
      mock(sendMeta).mockResolvedValue(undefined);

      const res = await deliverToChannel(conv({ channel: 'INSTAGRAM', contactPhone: 'IGSID_9' }), 'Hola', 'biz_1');

      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', type: 'INSTAGRAM', isActive: true } }),
      );
      expect(sendMeta).toHaveBeenCalledWith('TOKEN_IG', 'IGSID_9', 'Hola');
      expect(res.status).toBe('sent');
    });

    it('fuera de ventana (Meta code 10) devuelve un fallo legible', async () => {
      connectionConfig({ pageAccessToken: 'enc:T' });
      mock(sendMeta).mockRejectedValue(
        new Error('Meta Send API respondió 400: {"error":{"message":"(#10) outside of allowed window","code":10,"error_subcode":2018278}}'),
      );

      const res = await deliverToChannel(conv({ channel: 'INSTAGRAM', contactPhone: 'IGSID_9' }), 'Hola', 'biz_1');

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/24 h/);
    });

    it('sin conexión activa falla sin llamar a Meta', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const res = await deliverToChannel(conv({ channel: 'INSTAGRAM', contactPhone: 'IGSID_9' }), 'Hola', 'biz_1');

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/no está conectado/);
      expect(sendMeta).not.toHaveBeenCalled();
    });
  });

  describe('Messenger', () => {
    it('Messenger directo (WEBCHAT + realChannel) usa el token de la Connection MESSENGER', async () => {
      connectionConfig({ pageAccessToken: 'enc:TOKEN_FB' });
      mock(sendMeta).mockResolvedValue(undefined);

      const res = await deliverToChannel(
        conv({ channel: 'WEBCHAT', contactPhone: 'PSID_7', metadata: { realChannel: 'MESSENGER' } }),
        'Hola',
        'biz_1',
      );

      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', type: 'MESSENGER', isActive: true } }),
      );
      expect(sendMeta).toHaveBeenCalledWith('TOKEN_FB', 'PSID_7', 'Hola');
      expect(sendManychat).not.toHaveBeenCalled();
      expect(res.status).toBe('sent');
    });

    it('ManyChat (metadata.subscriberId) usa la API key guardada y no Meta', async () => {
      mock(loadMcConfig).mockResolvedValue({ apiKey: 'MC_KEY', enabled: true });
      mock(sendManychat).mockResolvedValue(undefined);

      const res = await deliverToChannel(
        conv({ channel: 'WEBCHAT', contactPhone: null, metadata: { realChannel: 'MESSENGER', subscriberId: 'sub_55' } }),
        'Hola',
        'biz_1',
      );

      expect(loadMcConfig).toHaveBeenCalledWith('biz_1');
      expect(sendManychat).toHaveBeenCalledWith('MC_KEY', 'sub_55', 'Hola');
      expect(sendMeta).not.toHaveBeenCalled();
      expect(res.status).toBe('sent');
    });

    it('ManyChat que rechaza el envío se informa como fallo', async () => {
      mock(loadMcConfig).mockResolvedValue({ apiKey: 'MC_KEY', enabled: true });
      mock(sendManychat).mockRejectedValue(new Error('ManyChat rechazó el envío (400)'));

      const res = await deliverToChannel(
        conv({ channel: 'WEBCHAT', metadata: { realChannel: 'MESSENGER', subscriberId: 'sub_55' } }),
        'Hola',
        'biz_1',
      );

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/400/);
    });
  });

  describe('Telegram', () => {
    it('envía con el bot del negocio al chat guardado en metadata.telegramChatId', async () => {
      connectionConfig({ botTokenEnc: 'enc:123:ABC' });
      telegramSend.mockResolvedValue({ message_id: 42 });

      const res = await deliverToChannel(
        conv({ channel: 'TELEGRAM', contactPhone: null, metadata: { telegramChatId: 998877 } }),
        'Hola',
        'biz_1',
      );

      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', type: 'TELEGRAM', isActive: true } }),
      );
      expect(telegramCtor).toHaveBeenCalledWith('123:ABC');
      expect(telegramSend).toHaveBeenCalledWith(998877, 'Hola');
      expect(res).toEqual({ status: 'sent', providerMessageId: '42' });
    });

    it('sin chat asociado falla con motivo y no usa el bot', async () => {
      const res = await deliverToChannel(conv({ channel: 'TELEGRAM', contactPhone: '+5491100000000' }), 'Hola', 'biz_1');

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/chat asociado/);
      expect(telegramSend).not.toHaveBeenCalled();
    });

    it('si el cliente bloqueó al bot lo informa legible', async () => {
      connectionConfig({ botTokenEnc: 'enc:123:ABC' });
      telegramSend.mockRejectedValue(Object.assign(new Error('Forbidden'), { error_code: 403, description: 'Forbidden: bot was blocked by the user' }));

      const res = await deliverToChannel(
        conv({ channel: 'TELEGRAM', metadata: { telegramChatId: '55' } }),
        'Hola',
        'biz_1',
      );

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/bloqueó/);
    });
  });

  describe('Web y Voz', () => {
    it('WEBCHAT sin canal externo es not_applicable y no llama a ningún proveedor', async () => {
      const res = await deliverToChannel(conv({ channel: 'WEBCHAT', contactPhone: null, metadata: null }), 'Hola', 'biz_1');

      expect(res).toEqual({ status: 'not_applicable' });
      expect(sendWhatsApp).not.toHaveBeenCalled();
      expect(sendMeta).not.toHaveBeenCalled();
      expect(sendManychat).not.toHaveBeenCalled();
      expect(telegramSend).not.toHaveBeenCalled();
    });

    it('VOICE (WEBCHAT + realChannel VOICE) es not_applicable aunque tenga teléfono', async () => {
      const res = await deliverToChannel(
        conv({ channel: 'WEBCHAT', contactPhone: '+5491100000000', metadata: { realChannel: 'VOICE' } }),
        'Hola',
        'biz_1',
      );

      expect(res.status).toBe('not_applicable');
      expect(sendWhatsApp).not.toHaveBeenCalled();
    });
  });

  describe('robustez', () => {
    it('nunca lanza: un error inesperado del proveedor termina en failed', async () => {
      mock(prisma.business.findFirst).mockRejectedValue(new Error('db caída'));

      await expect(deliverToChannel(conv({}), 'Hola', 'biz_1')).resolves.toMatchObject({ status: 'failed' });
    });

    it('si el proveedor no responde corta por timeout y avisa que revise antes de reintentar', async () => {
      vi.useFakeTimers();
      mock(sendWhatsApp).mockReturnValue(new Promise(() => {}));

      const pending = deliverToChannel(conv({}), 'Hola', 'biz_1');
      await vi.advanceTimersByTimeAsync(16_000);
      const res = await pending;

      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/tardó demasiado/);
    });
  });
});
