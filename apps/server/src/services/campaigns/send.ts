/**
 * Envío de campañas (servicio reutilizable).
 *
 * Extraído del handler de ruta `POST /api/campaigns/:id/send` para que tanto esa
 * ruta como el executor de automatizaciones (acción `lanzar_campana`) compartan
 * la MISMA lógica de envío, sin duplicarla.
 *
 * Mantiene el comportamiento original: claim ATÓMICO para evitar doble-envío
 * (TOCTOU), resolución de destinatarios scoped por negocio, despacho secuencial
 * por WhatsApp/Email (SMS/Telegram aún no soportados), y persistencia del conteo.
 */
import { prisma } from '../../lib/prisma';
import { getIO } from '../../lib/socket';
import { AppError } from '../../middleware/errorHandler';
import * as whatsapp from '../whatsapp/client';
import { sendGenericNotification } from '../email';

export interface SendCampaignResult {
  envio: { enviados: number; fallidos: number; canalSoportado: boolean };
  [key: string]: unknown;
}

/**
 * Envía la campaña `id` del negocio. Lanza AppError(404) si no existe y
 * AppError(400) si ya fue enviada. Devuelve la campaña actualizada + el resumen
 * de envío (`envio`).
 */
export async function sendCampaign(
  businessId: string,
  id: string,
  message?: string,
): Promise<SendCampaignResult> {
  // Claim ATÓMICO: marca 'sent' solo si todavía NO lo estaba. Dos envíos
  // concurrentes: solo uno gana el updateMany; el otro ve count=0 y corta.
  const claim = await prisma.campaign.updateMany({
    where: { id, businessId, status: { not: 'sent' } },
    data: { status: 'sent' },
  });
  if (claim.count === 0) {
    const exists = await prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true } });
    throw new AppError(exists ? 400 : 404, exists ? 'Campaign already sent' : 'Campaign not found');
  }

  const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
  if (!campaign) throw new AppError(404, 'Campaign not found'); // defensivo: no debería ocurrir tras el claim

  const body = (message)?.trim() || campaign.description || campaign.name;
  const subject = campaign.name;
  const channel = campaign.channel;

  // Destinatarios: clientes del negocio con al menos una reserva (scoped).
  const bookings = await prisma.booking.findMany({
    where: { businessId },
    select: { clientId: true },
    distinct: ['clientId'],
  });
  const clientIds = bookings.map((b) => b.clientId);
  const recipients = clientIds.length
    ? await prisma.user.findMany({
        where: { id: { in: clientIds }, businessId },
        select: { id: true, name: true, email: true, phone: true },
      })
    : [];

  // Canales con envío saliente real hoy: WhatsApp y Email.
  const soportado = channel === 'whatsapp' || channel === 'email';

  let enviados = 0;
  let fallidos = 0;

  if (soportado) {
    const senderNumber = channel === 'whatsapp' ? await resolveBusinessSender(businessId) : undefined;
    const waReady = channel === 'whatsapp' ? whatsapp.isConfigured() : true;

    // Secuencial: evita ráfagas. Un fallo por destinatario se cuenta y NO corta.
    for (const r of recipients) {
      try {
        if (channel === 'email') {
          if (!r.email) {
            fallidos++;
            continue;
          }
          const ok = await sendGenericNotification(r.email, subject, body);
          if (ok) enviados++;
          else fallidos++;
        } else {
          if (!waReady || !r.phone) {
            fallidos++;
            continue;
          }
          await whatsapp.sendMessage(r.phone, body, senderNumber);
          enviados++;
        }
      } catch (err) {
        fallidos++;
        console.error(`[Campaigns] Error enviando (canal ${channel}):`, describeError(err));
      }
    }
  } else {
    fallidos = recipients.length;
  }

  // El estado ya quedó 'sent' por el claim; acá solo persistimos el conteo.
  const updated = await prisma.campaign.update({
    where: { id },
    data: { sentCount: enviados },
  });

  getIO()?.to(`business:${businessId}`).emit('campaign:sent', {
    campaign: updated,
    envio: { enviados, fallidos },
  });

  return { ...updated, envio: { enviados, fallidos, canalSoportado: soportado } };
}

/**
 * Número de WhatsApp dedicado del negocio (remitente saliente). undefined si no
 * tiene uno (sendMessage cae al número global).
 */
async function resolveBusinessSender(businessId: string): Promise<string | undefined> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { whatsappNumber: true },
    });
    return business?.whatsappNumber || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Describe un error SIN filtrar PII del destinatario (los SDKs de Twilio/Resend
 * suelen incluir número/email en `message`): solo nombre y código.
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
