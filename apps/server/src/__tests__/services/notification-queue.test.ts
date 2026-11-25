/**
 * Cola de avisos de reservas y pedidos (services/notifications.ts): encola con
 * jobId estable e intentos, y el handler relee la entidad acotado por negocio y
 * LANZA si falla (así la cola reintenta). La cola se mockea (simula Redis activo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    booking: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
    notification: { create: vi.fn(async (args) => ({ id: 'n1', ...args.data })) },
    user: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => [{ id: 'adm_1' }]) },
    business: { findUnique: vi.fn(async () => ({ whatsappNumber: null })) },
  },
}));
vi.mock('../../services/email', () => ({ sendGenericNotification: vi.fn(async () => true) }));
vi.mock('../../services/whatsapp/client', () => ({ isConfigured: vi.fn(() => false), sendMessage: vi.fn() }));
vi.mock('../../lib/queue', () => ({
  defineQueue: vi.fn(),
  enqueue: vi.fn(async () => 'queued'),
}));

import { prisma } from '../../lib/prisma';
import { defineQueue, enqueue } from '../../lib/queue';
import {
  NOTIFICATION_QUEUE,
  NOTIFICATION_ATTEMPTS,
  NOTIFICATION_BACKOFF_MS,
  processNotificationJob,
  queueNotification,
} from '../../services/notifications';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

// defineQueue corre al importar el módulo (antes de que limpiemos los mocks).
const registered = [...mock(defineQueue).mock.calls];

const bookingRow = {
  id: 'b1', date: new Date('2026-10-01T00:00:00Z'), startTime: '15:00', clientId: 'c1', businessId: 'biz_1',
  client: { name: 'Ana' }, service: { name: 'Corte' },
};
const orderRow = { id: 'o1', status: 'CONFIRMED', clientId: 'c1', businessId: 'biz_1', client: { name: 'Ana' }, totalPrice: 1500 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cola notification-send: registro y encolado', () => {
  it('registra la cola con su handler', () => {
    expect(registered.some((c) => c[0] === NOTIFICATION_QUEUE && c[1] === processNotificationJob)).toBe(true);
  });

  it('encola con jobId estable por (evento, id) + reintentos con backoff', async () => {
    await queueNotification({ event: 'booking-created', id: 'b1', businessId: 'biz_1' });

    expect(enqueue).toHaveBeenCalledWith(
      NOTIFICATION_QUEUE,
      { event: 'booking-created', id: 'b1', businessId: 'biz_1' },
      { jobId: 'notif_booking-created_b1', attempts: NOTIFICATION_ATTEMPTS, backoffMs: NOTIFICATION_BACKOFF_MS },
    );
    expect(NOTIFICATION_ATTEMPTS).toBeGreaterThan(1);
  });

  it('el mismo evento y id produce SIEMPRE el mismo jobId (la cola lo deduplica)', async () => {
    await queueNotification({ event: 'booking-confirmed', id: 'b1', businessId: 'biz_1' });
    await queueNotification({ event: 'booking-confirmed', id: 'b1', businessId: 'biz_1' });

    const ids = mock(enqueue).mock.calls.map((c) => c[2].jobId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('eventos distintos de la misma reserva tienen jobId distinto', async () => {
    await queueNotification({ event: 'booking-confirmed', id: 'b1', businessId: 'biz_1' });
    await queueNotification({ event: 'booking-cancelled', id: 'b1', businessId: 'biz_1' });

    const ids = mock(enqueue).mock.calls.map((c) => c[2].jobId);
    expect(new Set(ids).size).toBe(2);
  });

  it('el aviso de estado de un pedido incluye el estado: cambios distintos no se pisan', async () => {
    await queueNotification({ event: 'order-status', id: 'o1', businessId: 'biz_1', status: 'CONFIRMED' });
    await queueNotification({ event: 'order-status', id: 'o1', businessId: 'biz_1', status: 'DELIVERED' });

    const ids = mock(enqueue).mock.calls.map((c) => c[2].jobId);
    expect(ids).toEqual(['notif_order-status_o1_CONFIRMED', 'notif_order-status_o1_DELIVERED']);
    // BullMQ no admite ":" en un jobId custom.
    expect(ids.every((id: string) => !id.includes(':'))).toBe(true);
  });

  it('el job lleva solo ids y negocio (nada de datos del cliente ni secretos)', async () => {
    await queueNotification({ event: 'order-created', id: 'o1', businessId: 'biz_1' });

    expect(Object.keys(mock(enqueue).mock.calls[0][1]).sort()).toEqual(['businessId', 'event', 'id']);
  });
});

describe('cola notification-send: handler', () => {
  it('relee la reserva acotada por negocio y crea el aviso al admin', async () => {
    mock(prisma.booking.findFirst).mockResolvedValue(bookingRow);

    await processNotificationJob({ event: 'booking-created', id: 'b1', businessId: 'biz_1' });

    expect(mock(prisma.booking.findFirst).mock.calls[0][0].where).toEqual({ id: 'b1', businessId: 'biz_1' });
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mock(prisma.notification.create).mock.calls[0][0].data).toMatchObject({ type: 'BOOKING_CREATED', userId: 'adm_1' });
  });

  it('multi-tenant: una reserva de otro negocio no se encuentra, no avisa y no lanza (no tiene sentido reintentar)', async () => {
    mock(prisma.booking.findFirst).mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(processNotificationJob({ event: 'booking-confirmed', id: 'b_ajena', businessId: 'biz_1' })).resolves.toBeUndefined();

    expect(prisma.notification.create).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('el pedido se relee por negocio y avisa del estado', async () => {
    mock(prisma.order.findFirst).mockResolvedValue(orderRow);

    await processNotificationJob({ event: 'order-status', id: 'o1', businessId: 'biz_1', status: 'CONFIRMED' });

    expect(mock(prisma.order.findFirst).mock.calls[0][0].where).toEqual({ id: 'o1', businessId: 'biz_1' });
    expect(mock(prisma.notification.create).mock.calls[0][0].data).toMatchObject({ type: 'ORDER_STATUS', userId: 'c1' });
  });

  it('order-status avisa el estado del JOB aunque el pedido ya haya avanzado (no el actual)', async () => {
    // El pedido ya está ENTREGADO, pero este job es el aviso de CONFIRMADO.
    mock(prisma.order.findFirst).mockResolvedValue({ ...orderRow, status: 'DELIVERED' });

    await processNotificationJob({ event: 'order-status', id: 'o1', businessId: 'biz_1', status: 'CONFIRMED' });

    expect(mock(prisma.notification.create).mock.calls[0][0].data).toMatchObject({ title: 'Pedido confirmado' });
  });

  it('order-status sin status en el job cae al estado actual del pedido', async () => {
    mock(prisma.order.findFirst).mockResolvedValue({ ...orderRow, status: 'READY' });

    await processNotificationJob({ event: 'order-status', id: 'o1', businessId: 'biz_1' });

    expect(mock(prisma.notification.create).mock.calls[0][0].data).toMatchObject({ title: 'Pedido listo para retirar' });
  });

  it('booking-confirmed se descarta si la reserva ya está cancelada (no dice "confirmada")', async () => {
    mock(prisma.booking.findFirst).mockResolvedValue({ ...bookingRow, status: 'CANCELLED' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(processNotificationJob({ event: 'booking-confirmed', id: 'b1', businessId: 'biz_1' })).resolves.toBeUndefined();

    expect(prisma.notification.create).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('booking-confirmed sigue avisando cuando la reserva está confirmada', async () => {
    mock(prisma.booking.findFirst).mockResolvedValue({ ...bookingRow, status: 'CONFIRMED' });

    await processNotificationJob({ event: 'booking-confirmed', id: 'b1', businessId: 'biz_1' });

    expect(mock(prisma.notification.create).mock.calls[0][0].data).toMatchObject({ type: 'BOOKING_CONFIRMED' });
  });

  it('si la DB falla LANZA, así la cola reintenta', async () => {
    mock(prisma.booking.findFirst).mockRejectedValue(new Error('db caída'));

    await expect(processNotificationJob({ event: 'booking-created', id: 'b1', businessId: 'biz_1' })).rejects.toThrow('db caída');
  });
});
