import { prisma } from '../lib/prisma';
import type { NotificationType, NotificationChannel } from '@prisma/client';
import { sendGenericNotification } from './email';
import * as whatsapp from './whatsapp/client';
import { defineQueue, enqueue, type EnqueueResult } from '../lib/queue';

// ─── Tipos ───────────────────────────────────────────────────────────

interface CreateNotificationData {
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  userId: string;
  businessId: string;
}

interface ClientNotificationData {
  type: NotificationType;
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

type Recipient = { email: string | null; phone: string | null } | null;

// ─── Servicio ────────────────────────────────────────────────────────

/**
 * Crea y persiste una notificación con un canal explícito y la despacha.
 * Pensada para notificaciones in-app del panel/scheduler (channel PUSH), pero
 * si se le pasa EMAIL/WHATSAPP resuelve el destinatario SCOPED por negocio.
 */
export async function createNotification(data: CreateNotificationData) {
  const notification = await prisma.notification.create({ data });
  const recipient =
    data.channel === 'EMAIL' || data.channel === 'WHATSAPP'
      ? await findRecipient(data.userId, data.businessId)
      : null;
  await deliver(notification, recipient);
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
 * Notifica al admin del negocio cuando entra un nuevo pedido (in-app / panel).
 */
export async function sendOrderCreated(order: OrderPayload) {
  const adminUsers = await prisma.user.findMany({
    where: { businessId: order.businessId, role: 'ADMIN' },
    select: { id: true },
  });

  const clientName = order.client?.name ?? 'Un cliente';
  const priceStr = Number(order.totalPrice).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
  });

  return Promise.all(
    adminUsers.map((admin) =>
      createNotification({
        type: 'ORDER_STATUS',
        channel: 'PUSH',
        title: 'Nuevo pedido recibido',
        body: `${clientName} hizo un pedido por ${priceStr}.`,
        userId: admin.id,
        businessId: order.businessId,
      })
    )
  );
}

/**
 * Notifica al cliente cuando su reserva es confirmada. El cliente no entra al
 * panel, así que se le llega por el mejor canal externo disponible.
 */
export async function sendBookingConfirmed(booking: BookingPayload) {
  const serviceName = booking.service?.name ?? 'tu servicio';
  const dateStr = formatDate(booking.date);

  return notifyClient({
    type: 'BOOKING_CONFIRMED',
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

  return notifyClient({
    type: 'BOOKING_CANCELLED',
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

  return notifyClient({
    type: 'BOOKING_REMINDER',
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

  return notifyClient({
    type: 'ORDER_STATUS',
    title: `Pedido ${statusLabel}`,
    body: `${clientName ? clientName + ', tu' : 'Tu'} pedido por ${priceStr} ahora está ${statusLabel}.`,
    userId: order.clientId,
    businessId: order.businessId,
  });
}

// ─── Cola de avisos de reservas y pedidos ────────────────────────────

/**
 * Los avisos de reservas/pedidos antes eran `void sendXxx(...)` dentro del
 * request: si la DB fallaba un instante (buscar admins/cliente, crear la
 * notificación) el aviso se perdía sin reintento. Ahora van por una cola con
 * reintentos (BullMQ con Redis; sin Redis corren inline, como antes).
 *
 * El job lleva solo ids (nunca datos del cliente ni secretos): el handler relee
 * la reserva/pedido de la DB acotado por `businessId`, así el aviso refleja el
 * dato actual y es multi-tenant por construcción.
 *
 * Idempotencia: `jobId` estable por (evento, id[, estado]). Encolar dos veces el
 * mismo evento (doble click, reintento del cliente HTTP) lo envía una sola vez
 * mientras BullMQ retiene el job (~1 h). Límite conocido: confirmar → cancelar →
 * confirmar la MISMA reserva dentro de esa hora no repite el aviso de confirmación.
 *
 * Reintentos: solo se reintenta si el handler LANZA (fallo de DB al armar o
 * persistir el aviso). Los envíos externos (WhatsApp/email) siguen siendo
 * fire-and-forget dentro de `deliver`: reintentarlos duplicaría la notificación
 * in-app ya creada. Un reintento tras un fallo parcial puede duplicar la fila
 * in-app de algún admin; es preferible a perder el aviso.
 */
export const NOTIFICATION_QUEUE = 'notification-send';

export type NotificationEvent =
  | 'booking-created'
  | 'booking-confirmed'
  | 'booking-cancelled'
  | 'order-created'
  | 'order-status';

export interface NotificationJob {
  event: NotificationEvent;
  /** Id de la reserva o del pedido. */
  id: string;
  businessId: string;
  /** Solo `order-status`: el estado que se notifica (entra en el jobId). */
  status?: string;
}

/** Intentos totales y espera base (backoff exponencial) de los avisos. */
export const NOTIFICATION_ATTEMPTS = 3;
export const NOTIFICATION_BACKOFF_MS = 5000;

/** Ejecuta un aviso encolado. Lanza si falla (así la cola reintenta). */
export async function processNotificationJob(job: NotificationJob): Promise<void> {
  if (job.event.startsWith('booking-')) {
    const booking = await prisma.booking.findFirst({
      where: { id: job.id, businessId: job.businessId },
      include: { client: { select: { name: true } }, service: { select: { name: true } } },
    });
    if (!booking) {
      console.warn('[Notifications] Reserva no encontrada para el aviso; se omite.', { event: job.event, id: job.id });
      return;
    }
    if (job.event === 'booking-created') await sendBookingCreated(booking);
    else if (job.event === 'booking-confirmed') {
      // El aviso se manda un rato después de encolarlo: si mientras tanto la reserva
      // se canceló, decir "confirmada" sería falso. Se relee el estado y se descarta.
      if (booking.status === 'CANCELLED') {
        console.warn('[Notifications] La reserva ya está cancelada; se descarta el aviso de confirmación.', { id: job.id });
        return;
      }
      await sendBookingConfirmed(booking);
    }
    else await sendBookingCancelled(booking);
    return;
  }

  const order = await prisma.order.findFirst({
    where: { id: job.id, businessId: job.businessId },
    include: { client: { select: { name: true } } },
  });
  if (!order) {
    console.warn('[Notifications] Pedido no encontrado para el aviso; se omite.', { event: job.event, id: job.id });
    return;
  }
  if (job.event === 'order-created') await sendOrderCreated(order);
  else {
    // Se notifica el estado del EVENTO (job.status), no el actual del pedido: si el
    // pedido avanzó (CONFIRMED -> DELIVERED) antes de procesar el job, cada aviso
    // debe decir el estado que lo originó (el jobId ya es idempotente por estado).
    await sendOrderStatusUpdate({ ...order, status: job.status ?? order.status });
  }
}

defineQueue<NotificationJob>(NOTIFICATION_QUEUE, processNotificationJob, { concurrency: 5 });

/**
 * Encola un aviso con jobId idempotente. Nunca lanza. Llamar SIN await desde las
 * rutas (`void queueNotification(...)`): la respuesta HTTP no espera el envío ni
 * siquiera en modo inline (sin Redis).
 */
export function queueNotification(job: NotificationJob): Promise<EnqueueResult> {
  const jobId = ['notif', job.event, job.id, ...(job.status ? [job.status] : [])].join('_');
  return enqueue<NotificationJob>(NOTIFICATION_QUEUE, job, {
    jobId,
    attempts: NOTIFICATION_ATTEMPTS,
    backoffMs: NOTIFICATION_BACKOFF_MS,
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
 * Busca al destinatario SIEMPRE acotado por negocio. Esto es lo que impide una
 * fuga entre tenants: aunque una reserva/pedido se haya creado con un `userId`
 * de otro negocio, acá no lo encontramos (id + businessId) y no sale ningún
 * envío externo. Nunca lanza: ante error o no-match, devuelve null.
 */
async function findRecipient(userId: string, businessId: string): Promise<Recipient> {
  try {
    // findFirst con {id, businessId}: id es único, pero el filtro por negocio
    // garantiza el aislamiento multi-tenant en el envío.
    return await prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { email: true, phone: true },
    });
  } catch (err) {
    console.error('[Notifications] Error buscando destinatario:', describeError(err));
    return null;
  }
}

/**
 * Elige el mejor canal externo para un destinatario ya resuelto:
 *   WhatsApp (teléfono + Twilio configurado) > email > PUSH (solo in-app).
 */
function pickChannel(recipient: Recipient): NotificationChannel {
  if (whatsapp.isConfigured() && recipient?.phone) return 'WHATSAPP';
  if (recipient?.email) return 'EMAIL';
  return 'PUSH';
}

/**
 * Notifica a un cliente por su mejor canal externo. Hace UNA sola búsqueda del
 * destinatario (acotada por negocio) y la reutiliza para elegir canal y para
 * despachar. Si el usuario no pertenece al negocio, cae a PUSH (in-app) y no
 * sale nada al exterior.
 */
async function notifyClient(data: ClientNotificationData) {
  const recipient = await findRecipient(data.userId, data.businessId);
  const channel = pickChannel(recipient);
  const notification = await prisma.notification.create({ data: { ...data, channel } });
  // Para WhatsApp, resolvemos el número dedicado del negocio como remitente.
  const senderNumber = channel === 'WHATSAPP' ? await resolveBusinessSender(data.businessId) : undefined;
  await deliver(notification, recipient, senderNumber);
  return notification;
}

/**
 * Número de WhatsApp dedicado del negocio (remitente saliente). Es el mismo por
 * el que Twilio enruta los entrantes, así que está aprovisionado en la cuenta.
 * Devuelve undefined si el negocio no tiene uno (deliver cae al número global).
 */
async function resolveBusinessSender(businessId: string): Promise<string | undefined> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { whatsappNumber: true },
    });
    return business?.whatsappNumber || undefined;
  } catch (err) {
    console.error('[Notifications] Error resolviendo remitente del negocio:', describeError(err));
    return undefined;
  }
}

/**
 * Despacha la notificación al canal externo usando el destinatario ya resuelto
 * (que fue buscado acotado por negocio). Fire-and-forget: los errores se
 * loguean redactados y nunca lanzan ni bloquean el flujo que la originó.
 */
async function deliver(
  notification: { channel: string; title: string; body: string },
  recipient: Recipient,
  senderNumber?: string,
) {
  const text = `${notification.title}\n\n${notification.body}`;

  switch (notification.channel) {
    case 'EMAIL': {
      if (!recipient?.email) {
        console.warn('[Notifications] Sin email para el destinatario; se omite.');
        return;
      }
      // Fire-and-forget: no awaiteamos para no bloquear el flujo principal.
      sendGenericNotification(recipient.email, notification.title, notification.body).catch((err) =>
        console.error('[Notifications] Error despachando email:', describeError(err))
      );
      return;
    }

    case 'WHATSAPP': {
      if (!whatsapp.isConfigured() || !recipient?.phone) {
        console.warn('[Notifications] WhatsApp no disponible para el destinatario; se omite.');
        return;
      }
      whatsapp.sendMessage(recipient.phone, text, senderNumber).catch((err) =>
        console.error('[Notifications] Error despachando WhatsApp:', describeError(err))
      );
      return;
    }

    case 'PUSH':
      // In-app: se muestra en la campana del panel. La persistencia ES la entrega;
      // no hay envío externo.
      return;

    case 'TELEGRAM':
    case 'SMS':
      // El schema no guarda una dirección por-usuario para estos canales
      // (chatId de Telegram / número verificado de SMS). Queda registrada in-app.
      console.log(`[Notifications] Canal ${notification.channel} sin destino por-usuario; queda solo in-app.`);
      return;

    default:
      console.warn(`[Notifications] Canal desconocido: ${notification.channel}`);
  }
}

/**
 * Describe un error para logs SIN filtrar PII del destinatario: los SDKs de
 * Twilio/Resend suelen incluir el número/email en `message` (ej: "The 'To'
 * number +54... is not valid"), así que logueamos solo nombre y código.
 */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: string | number; status?: number; name?: string };
    const parts: string[] = [];
    if (e.name) parts.push(e.name);
    if (e.code !== undefined) parts.push(`code ${e.code}`);
    if (e.status !== undefined) parts.push(`status ${e.status}`);
    if (parts.length) return parts.join(' ');
  }
  return 'error desconocido';
}
