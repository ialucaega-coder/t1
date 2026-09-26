/**
 * Pruebas del servicio de notificaciones (services/notifications.ts):
 * resolución del mejor canal externo para el cliente (WhatsApp > email > PUSH),
 * despacho real por canal y la garantía de que un fallo de envío nunca rompe
 * el flujo que originó la notificación.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    notification: { create: vi.fn(async (args) => ({ id: 'n1', ...args.data })) },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('../../services/email', () => ({
  sendGenericNotification: vi.fn(async () => true),
}));
vi.mock('../../services/whatsapp/client', () => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async () => 'SID123'),
}));

import { prisma } from '../../lib/prisma';
import { sendGenericNotification } from '../../services/email';
import * as whatsapp from '../../services/whatsapp/client';
import {
  sendBookingConfirmed,
  sendBookingCreated,
  sendOrderCreated,
  sendOrderStatusUpdate,
} from '../../services/notifications';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const booking = {
  id: 'b1',
  date: new Date('2026-10-01T00:00:00Z'),
  startTime: '15:00',
  clientId: 'client_1',
  businessId: 'biz_1',
  service: { name: 'Corte' },
  client: { name: 'Ana' },
};

describe('services/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(whatsapp.isConfigured).mockReturnValue(true);
    mock(prisma.notification.create).mockImplementation(async (args: { data: unknown }) => ({
      id: 'n1',
      ...(args.data as object),
    }));
  });

  describe('sendBookingConfirmed — resolución de canal', () => {
    it('usa WhatsApp cuando el cliente tiene teléfono y Twilio está configurado', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ phone: '+5491122334455', email: 'ana@mail.com' });

      await sendBookingConfirmed(booking);

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'WHATSAPP', type: 'BOOKING_CONFIRMED' }) })
      );
      expect(mock(whatsapp.sendMessage)).toHaveBeenCalledWith('+5491122334455', expect.stringContaining('Reserva confirmada'));
      expect(mock(sendGenericNotification)).not.toHaveBeenCalled();
    });

    it('busca al destinatario SCOPED por businessId (aislamiento multi-tenant)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ phone: '+549112233', email: null });

      await sendBookingConfirmed(booking);

      // El fix crítico: la búsqueda del destinatario filtra por negocio, así un
      // clientId de otro tenant no recibe el envío externo.
      expect(mock(prisma.user.findFirst)).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'client_1', businessId: 'biz_1' } })
      );
    });

    it('no envía nada al exterior si el usuario no pertenece al negocio (findFirst null)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      await sendBookingConfirmed(booking);

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'PUSH' }) })
      );
      expect(mock(whatsapp.sendMessage)).not.toHaveBeenCalled();
      expect(mock(sendGenericNotification)).not.toHaveBeenCalled();
    });

    it('cae a email cuando no hay teléfono', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ phone: null, email: 'ana@mail.com' });

      await sendBookingConfirmed(booking);

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'EMAIL' }) })
      );
      expect(mock(sendGenericNotification)).toHaveBeenCalledWith('ana@mail.com', 'Reserva confirmada', expect.any(String));
      expect(mock(whatsapp.sendMessage)).not.toHaveBeenCalled();
    });

    it('cae a email cuando Twilio no está configurado aunque haya teléfono', async () => {
      mock(whatsapp.isConfigured).mockReturnValue(false);
      mock(prisma.user.findFirst).mockResolvedValue({ phone: '+549112233', email: 'ana@mail.com' });

      await sendBookingConfirmed(booking);

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'EMAIL' }) })
      );
      expect(mock(whatsapp.sendMessage)).not.toHaveBeenCalled();
    });

    it('cae a PUSH (in-app) cuando el cliente no tiene ni teléfono ni email', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ phone: null, email: null });

      await sendBookingConfirmed(booking);

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'PUSH' }) })
      );
      expect(mock(whatsapp.sendMessage)).not.toHaveBeenCalled();
      expect(mock(sendGenericNotification)).not.toHaveBeenCalled();
    });
  });

  describe('sendBookingCreated — notificación al admin (in-app)', () => {
    it('crea una notificación PUSH por cada admin, sin envío externo', async () => {
      mock(prisma.user.findMany).mockResolvedValue([{ id: 'admin_1' }, { id: 'admin_2' }]);

      const result = await sendBookingCreated(booking);

      expect(result).toHaveLength(2);
      expect(mock(prisma.notification.create)).toHaveBeenCalledTimes(2);
      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'PUSH', userId: 'admin_1' }) })
      );
      expect(mock(whatsapp.sendMessage)).not.toHaveBeenCalled();
      expect(mock(sendGenericNotification)).not.toHaveBeenCalled();
    });

    it('sendOrderCreated crea PUSH por cada admin sin envío externo', async () => {
      mock(prisma.user.findMany).mockResolvedValue([{ id: 'admin_1' }]);

      await sendOrderCreated({
        id: 'o1',
        status: 'PENDING',
        clientId: 'client_1',
        businessId: 'biz_1',
        client: { name: 'Ana' },
        totalPrice: 2500,
      });

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'PUSH', title: 'Nuevo pedido recibido', userId: 'admin_1' }) })
      );
      expect(mock(whatsapp.sendMessage)).not.toHaveBeenCalled();
    });
  });

  describe('robustez', () => {
    it('no lanza aunque el envío de WhatsApp falle', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ phone: '+549112233', email: null });
      mock(whatsapp.sendMessage).mockRejectedValue(new Error('twilio down'));

      await expect(sendBookingConfirmed(booking)).resolves.toBeTruthy();
    });

    it('cae a PUSH si el lookup del cliente falla al resolver el canal', async () => {
      mock(prisma.user.findFirst).mockRejectedValueOnce(new Error('db error'));

      await sendOrderStatusUpdate({
        id: 'o1',
        status: 'READY',
        clientId: 'client_1',
        businessId: 'biz_1',
        client: { name: 'Ana' },
        totalPrice: 1500,
      });

      expect(mock(prisma.notification.create)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'PUSH', type: 'ORDER_STATUS' }) })
      );
    });
  });
});
