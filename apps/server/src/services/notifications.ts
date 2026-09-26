import { prisma } from '../lib/prisma';
import type { NotificationType, NotificationChannel } from '@prisma/client';
import { sendGenericNotification } from './email';
import * as whatsapp from './whatsapp/client';

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
 * Crea y persiste una notificación en la base de datos y la despacha al canal
 * externo correspondiente (WhatsApp / email) cuando aplica. El despacho es
 * best-effort: nunca lanza ni bloquea el flujo que la originó.
 */
export async function createNotification(data: CreateNotificationData) {
  const notification = await prisma.notification.create({ data });
  await dispatchToChannel(notification);
  return notification;
}

/**
 * Notifica al admin del negocio cuando se crea una nueva reserva.
 *
 * El admin trabaja en el panel, así que la notificación es in-app (PUSH): se
 * muestra en la campana del dashboard. No requiere envío externo.
 */
export async function sendBookingCreated(booking: BookingPayload) {
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
 * Notifica al cliente cuando su reserva es confirmada. El cliente no entra al
 * panel, así que se le llega por el mejor canal externo disponible
 * (WhatsApp si tiene teléfono y hay Twilio; si no, email).
 */
export async function sendBookingConfirmed(booking: BookingPayload) {
  const serviceName = booking.service?.name ?? 'tu servicio';
  const dateStr = formatDate(booking.date);
  const channel = await resolveClientChannel(booking.clientId);

  return createNotification({
    type: 'BOOKING_CONFIRMED',
    channel,
    title: 'Reserva confirmada',
    body: `Tu reserva de ${serviceName} para el ${dateStr} a las ${booking.startTime} ha sido confirmada.`,
    userId: booking.clientId,
    businessId: booking.businessId,
  });
}

/**
 * Notifica al cliente cuando su reserva es cancelada.
 */
export async function sendBookingCancelled(booking: BookingPayload) {
  const serviceName = booking.service?.name ?? 'tu servicio';
  const dateStr = formatDate(booking.date);
  const channel = await resolveClientChannel(booking.clientId);

  return createNotification({
    type: 'BOOKING_CANCELLED',
    channel,
    title: 'Reserva cancelada',
    body: `Tu reserva de ${serviceName} para el ${dateStr} a las ${booking.startTime} fue cancelada. Si fue un error, escribinos para reprogramarla.`,
    userId: booking.clientId,
    businessId: booking.businessId,
  });
}

/**
 * Envía recordatorio de la cita al cliente por su mejor canal externo.
 */
export async function sendBookingReminder(booking: BookingPayload) {
  const serviceName = booking.service?.name ?? 'tu cita';
  const dateStr = formatDate(booking.date);
  const channel = await resolveClientChannel(booking.clientId);

  return createNotification({
    type: 'BOOKING_REMINDER',
    channel,
    title: 'Recordatorio de cita',
    body: `Tu cita de ${serviceName} es hoy ${dateStr} a las ${booking.startTime}. ¡Te esperamos!`,
    userId: booking.clientId,
    businessId: booking.businessId,
  });
}

/**
 * Notifica al cliente cuando cambia el estado de su pedido, por su mejor canal.
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
  const channel = await resolveClientChannel(order.clientId);

  return createNotification({
    type: 'ORDER_STATUS',
    channel,
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
 * Elige el mejor canal externo para llegarle a un cliente según lo que tenga
 * cargado y lo que la plataforma tenga configurado:
 *   WhatsApp (teléfono + Twilio configurado) > email > PUSH (solo in-app).
 * Nunca lanza: ante cualquier fallo cae a PUSH (queda registrada in-app).
 */
async function resolveClientChannel(userId: string): Promise<NotificationChannel> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, email: true },
    });
    if (whatsapp.isConfigured() && user?.phone) return 'WHATSAPP';
    if (user?.email) return 'EMAIL';
  } catch (err) {
    console.error('[Notifications] Error resolviendo canal del cliente:', err);
  }
  return 'PUSH';
}

/**
 * Despacha la notificación al canal externo correspondiente.
 * El envío es fire-and-forget: los errores se loguean pero no bloquean ni
 * lanzan (una notificación que no sale no debe romper la reserva/pedido).
 */
async function dispatchToChannel(notification: {
  channel: string;
  title: string;
  body: string;
  userId: string;
}) {
  // Un solo lookup del destinatario, reutilizado por email y WhatsApp.
  let user: { email: string | null; phone: string | null } | null = null;
  if (notification.channel === 'EMAIL' || notification.channel === 'WHATSAPP') {
    try {
      user = await prisma.user.findUnique({
        where: { id: notification.userId },
        select: { email: true, phone: true },
      });
    } catch (err) {
      console.error('[Notifications] Error buscando destinatario:', err);
      return;
    }
  }

  const text = `${notification.title}\n\n${notification.body}`;

  switch (notification.channel) {
    case 'EMAIL': {
      if (!user?.email) {
        console.warn(`[Notifications] Sin email para el usuario ${notification.userId}`);
        return;
      }
      // Fire-and-forget: no awaiteamos para no bloquear el flujo principal.
      sendGenericNotification(user.email, notification.title, notification.body).catch((err) =>
        console.error('[Notifications] Error despachando email:', err)
      );
      return;
    }

    case 'WHATSAPP': {
      if (!whatsapp.isConfigured() || !user?.phone) {
        console.warn(`[Notifications] WhatsApp no disponible para el usuario ${notification.userId}`);
        return;
      }
      whatsapp.sendMessage(user.phone, text).catch((err) =>
        console.error('[Notifications] Error despachando WhatsApp:', err)
      );
      return;
    }

    case 'PUSH':
      // In-app: se muestra en la campana del panel. La persistencia ES la entrega;
      // no hay envío externo (el cliente que no usa el panel se notifica por otro canal).
      return;

    case 'TELEGRAM':
    case 'SMS':
      // El schema no guarda una dirección por-usuario para estos canales
      // (chatId de Telegram / número verificado de SMS), así que no podemos
      // resolver un destino. Queda registrada in-app.
      console.log(
        `[Notifications] Canal ${notification.channel} sin destino por-usuario; queda solo in-app.`
      );
      return;

    default:
      console.warn(`[Notifications] Canal desconocido: ${notification.channel}`);
  }
}
