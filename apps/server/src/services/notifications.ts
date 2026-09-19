import { prisma } from '../lib/prisma';
import type { NotificationType, NotificationChannel } from '@prisma/client';
import { sendGenericNotification } from './email';

// ─── Tipos ───────────────────────────────────────────────────────────

interface CreateNotificationData {
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  userId: string;
  businessId: string;
}

interface BookingPayload {
  id: string;
  date: Date;
  startTime: string;
  clientId: string;
  businessId: string;
  client?: { name: string };
  service?: { name: string };
}

interface OrderPayload {
  id: string;
  status: string;
  clientId: string;
  businessId: string;
  client?: { name: string };
  totalPrice: unknown; // Decimal from Prisma
}

// ─── Servicio ────────────────────────────────────────────────────────

/**
 * Crea y persiste una notificación en la base de datos.
 * Despacha al canal externo correspondiente (email vía Resend, otros pendientes).
 */
export async function createNotification(data: CreateNotificationData) {
  const notification = await prisma.notification.create({ data });
  // TODO: Despachar al canal correspondiente (email, WhatsApp, push, etc.)
  await dispatchToChannel(notification);
  return notification;
}

/**
 * Notifica al admin del negocio cuando se crea una nueva reserva.
 */
export async function sendBookingCreated(booking: BookingPayload) {
  // Buscar el owner (admin) del negocio
  const adminUsers = await prisma.user.findMany({
    where: { businessId: booking.businessId, role: 'ADMIN' },
    select: { id: true },
  });

  const clientName = booking.client?.name ?? 'Un cliente';
  const serviceName = booking.service?.name ?? 'un servicio';
  const dateStr = formatDate(booking.date);

  const notifications = await Promise.all(
    adminUsers.map((admin) =>
      createNotification({
        type: 'BOOKING_CREATED',
        channel: 'PUSH',
        title: 'Nueva reserva recibida',
        body: `${clientName} reservó ${serviceName} para el ${dateStr} a las ${booking.startTime}.`,
        userId: admin.id,
        businessId: booking.businessId,
      })
    )
  );

  return notifications;
}

/**
 * Notifica al cliente cuando su reserva es confirmada.
 */
export async function sendBookingConfirmed(booking: BookingPayload) {
  const serviceName = booking.service?.name ?? 'tu servicio';
  const dateStr = formatDate(booking.date);

  return createNotification({
    type: 'BOOKING_CONFIRMED',
    channel: 'PUSH',
    title: 'Reserva confirmada',
    body: `Tu reserva de ${serviceName} para el ${dateStr} a las ${booking.startTime} ha sido confirmada.`,
    userId: booking.clientId,
    businessId: booking.businessId,
  });
}

/**
 * Envía recordatorio 1 hora antes de la cita.
 */
export async function sendBookingReminder(booking: BookingPayload) {
  const serviceName = booking.service?.name ?? 'tu cita';
  const dateStr = formatDate(booking.date);

  return createNotification({
    type: 'BOOKING_REMINDER',
    channel: 'PUSH',
    title: 'Recordatorio de cita',
    body: `Tu cita de ${serviceName} es hoy ${dateStr} a las ${booking.startTime}. ¡Te esperamos!`,
    userId: booking.clientId,
    businessId: booking.businessId,
  });
}

/**
 * Notifica al cliente cuando cambia el estado de su pedido.
 */
export async function sendOrderStatusUpdate(order: OrderPayload) {
  const statusLabels: Record<string, string> = {
    PENDING: 'pendiente',
    CONFIRMED: 'confirmado',
    PREPARING: 'en preparación',
    READY: 'listo para retirar',
    DELIVERED: 'entregado',
    CANCELLED: 'cancelado',
  };

  const statusLabel = statusLabels[order.status] ?? order.status.toLowerCase();
  const clientName = order.client?.name ?? '';
  const priceStr = Number(order.totalPrice).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
  });

  return createNotification({
    type: 'ORDER_STATUS',
    channel: 'PUSH',
    title: `Pedido ${statusLabel}`,
    body: `${clientName ? clientName + ', tu' : 'Tu'} pedido por ${priceStr} ahora está ${statusLabel}.`,
    userId: order.clientId,
    businessId: order.businessId,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Despacha la notificación al canal externo correspondiente.
 * El envío es fire-and-forget: los errores se loguean pero no bloquean.
 */
async function dispatchToChannel(notification: {
  channel: string;
  title: string;
  body: string;
  userId: string;
}) {
  switch (notification.channel) {
    case 'EMAIL': {
      // Buscar email del usuario destinatario
      const user = await prisma.user.findUnique({
        where: { id: notification.userId },
        select: { email: true },
      });

      if (!user?.email) {
        console.warn(
          `[Notifications] No se encontró email para el usuario ${notification.userId}`
        );
        return;
      }

      // Fire-and-forget: no awaiteamos para no bloquear el flujo principal
      sendGenericNotification(user.email, notification.title, notification.body)
        .catch((err) =>
          console.error('[Notifications] Error despachando email:', err)
        );
      return;
    }

    case 'WHATSAPP':
    case 'SMS':
    case 'TELEGRAM':
      // TODO: Integrar Twilio / WhatsApp Business API
      console.log(
        `[Notifications] Canal ${notification.channel} pendiente de implementación`
      );
      return;

    case 'PUSH':
      // TODO: Integrar Web Push / Firebase Cloud Messaging
      console.log('[Notifications] Canal PUSH pendiente de implementación');
      return;

    default:
      console.warn(
        `[Notifications] Canal desconocido: ${notification.channel}`
      );
  }
}
