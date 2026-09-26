import { Resend } from 'resend';
import {
  bookingConfirmationTemplate,
  bookingReminderTemplate,
  orderStatusTemplate,
  welcomeTemplate,
  invoiceTemplate,
  genericNotificationTemplate,
  type BookingEmailData,
  type OrderEmailData,
  type InvoiceEmailData,
} from './email-templates';

// ─── Configuración ──────────────────────────────────────────────────

const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Local B <noreply@localb.app>';

// Cliente Resend perezoso: no lo construimos en la carga del módulo para que
// la ausencia de RESEND_API_KEY no rompa el arranque del server (ni los tests
// que importan servicios que dependen de email). Si no hay key, `send` degrada
// devolviendo false sin lanzar.
let cachedResend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!cachedResend) cachedResend = new Resend(process.env.RESEND_API_KEY);
  return cachedResend;
}

// ─── Helper interno ─────────────────────────────────────────────────

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

async function send(params: SendEmailParams): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY no configurada; se omite el envío de email.');
    return false;
  }
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      console.error('[Email] Error al enviar email:', error);
      return false;
    }

    console.log(`[Email] Enviado a ${params.to}: "${params.subject}"`);
    return true;
  } catch (err) {
    console.error('[Email] Excepción al enviar email:', err);
    return false;
  }
}

// ─── Funciones públicas ─────────────────────────────────────────────

/**
 * Envía email de confirmación de reserva.
 */
export async function sendBookingConfirmation(
  to: string,
  booking: BookingEmailData
): Promise<boolean> {
  return send({
    to,
    subject: `Reserva confirmada - ${booking.serviceName}`,
    html: bookingConfirmationTemplate(booking),
  });
}

/**
 * Envía recordatorio de reserva (24h antes).
 */
export async function sendBookingReminder(
  to: string,
  booking: BookingEmailData
): Promise<boolean> {
  return send({
    to,
    subject: `Recordatorio: ${booking.serviceName} - ${booking.date}`,
    html: bookingReminderTemplate(booking),
  });
}

/**
 * Envía actualización de estado de pedido.
 */
export async function sendOrderStatusUpdate(
  to: string,
  order: OrderEmailData
): Promise<boolean> {
  return send({
    to,
    subject: `Tu pedido está ${order.status}`,
    html: orderStatusTemplate(order),
  });
}

/**
 * Envía email de bienvenida al registrarse.
 */
export async function sendWelcomeEmail(
  to: string,
  userName: string,
  businessName: string
): Promise<boolean> {
  return send({
    to,
    subject: `Bienvenido/a a ${businessName || 'Local B'}`,
    html: welcomeTemplate(userName, businessName),
  });
}

/**
 * Envía comprobante / factura por email.
 */
export async function sendInvoiceEmail(
  to: string,
  invoice: InvoiceEmailData
): Promise<boolean> {
  return send({
    to,
    subject: `Comprobante de pago - ${invoice.invoiceNumber}`,
    html: invoiceTemplate(invoice),
  });
}

/**
 * Envía una notificación genérica por email.
 */
export async function sendGenericNotification(
  to: string,
  subject: string,
  htmlContent: string
): Promise<boolean> {
  return send({
    to,
    subject,
    html: genericNotificationTemplate(subject, htmlContent),
  });
}
