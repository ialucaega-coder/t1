/**
 * Envío de campañas (servicio reutilizable).
 *
 * Extraído del handler de ruta `POST /api/campaigns/:id/send` para que tanto esa
 * ruta como el executor de automatizaciones (acción `lanzar_campana`) compartan
 * la MISMA lógica de envío, sin duplicarla.
 *
 * Flujo:
 *  1. `sendCampaign` hace el claim ATÓMICO (draft/scheduled → 'sending'): dos
 *     envíos concurrentes → solo uno gana; el otro ve "ya enviada/en envío".
 *  2. Encola el trabajo (`campaign-send`). Con Redis lo ejecuta un worker y la
 *     request devuelve enseguida (`envio.enCola: true`); sin Redis corre inline y
 *     la request espera el resultado final, igual que antes de las colas.
 *  3. `deliverCampaign` recorre los destinatarios por lotes (ids ordenados) y
 *     guarda un CURSOR (enviados/fallidos/procesados) tras cada destinatario:
 *     si el proceso muere o el job se reintenta, retoma donde quedó en vez de
 *     reenviar a todos. Al terminar pasa a 'sent'; si agota los intentos, 'failed'.
 */
import { prisma } from '../../lib/prisma';
import { getIO } from '../../lib/socket';
import { AppError } from '../../middleware/errorHandler';
import { defineQueue, enqueue } from '../../lib/queue';
import { sharedGet, sharedSet, sharedDel } from '../../lib/sharedState';
import * as whatsapp from '../whatsapp/client';
import { sendGenericNotification } from '../email';

export interface SendCampaignResult {
  envio: { enviados: number; fallidos: number; canalSoportado: boolean; enCola?: boolean };
  [key: string]: unknown;
}

const CAMPAIGN_QUEUE = 'campaign-send';
/** Reintentos del job completo (cada uno retoma desde el cursor). */
const MAX_ATTEMPTS = 3;
/** Tamaño de lote al resolver destinatarios (evita un IN gigante). */
const RECIPIENT_BATCH = 500;
/** Cada cuántos destinatarios se refleja el progreso en `sentCount` (visible en el panel). */
const PROGRESS_EVERY = 25;
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

interface CampaignJob {
  businessId: string;
  id: string;
  message?: string;
}

/** Progreso persistido (Redis/memoria) para poder retomar un envío interrumpido. */
interface Cursor {
  processed: number;
  enviados: number;
  fallidos: number;
  tries: number;
}

const cursorKey = (businessId: string, id: string) => `campaign:${businessId}:${id}:cursor`;

/** Resultado del último envío inline (sin Redis) para devolverlo al caller. */
const inlineResults = new Map<string, SendCampaignResult>();

/**
 * Envía la campaña `id` del negocio. Lanza AppError(404) si no existe y
 * AppError(400) si ya fue enviada (o se está enviando). Devuelve la campaña + el
 * resumen de envío (`envio`); con colas reales el resumen es provisional
 * (`enCola: true`) y el definitivo llega por el evento `campaign:sent`.
 */
export async function sendCampaign(
  businessId: string,
  id: string,
  message?: string,
): Promise<SendCampaignResult> {
  // Claim ATÓMICO: pasa a 'sending' solo si NO estaba ya 'sent' ni 'sending'.
  const claim = await prisma.campaign.updateMany({
    where: { id, businessId, status: { notIn: ['sent', 'sending'] } },
    data: { status: 'sending' },
  });
  if (claim.count === 0) {
    const exists = await prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true } });
    throw new AppError(exists ? 400 : 404, exists ? 'Campaign already sent' : 'Campaign not found');
  }

  const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
  if (!campaign) throw new AppError(404, 'Campaign not found'); // defensivo: no debería ocurrir tras el claim

  await sharedDel(cursorKey(businessId, id)); // envío nuevo: sin progreso previo

  const how = await enqueue<CampaignJob>(
    CAMPAIGN_QUEUE,
    { businessId, id, message },
    // El dedupe de doble disparo ya lo hace el claim atómico de arriba; el jobId es
    // único por envío (si fuera fijo por campaña, reenviar una campaña 'failed'
    // chocaría con el job viejo retenido en la cola). Reintentos con backoff; cada
    // uno retoma desde el cursor.
    { jobId: `campaign_${id}_${Date.now()}`, attempts: MAX_ATTEMPTS, backoffMs: 5000 },
  );

  if (how === 'queued') {
    return {
      ...campaign,
      status: 'sending',
      envio: { enviados: 0, fallidos: 0, canalSoportado: isSupportedChannel(campaign.channel), enCola: true },
    };
  }

  // Inline: el job ya terminó; devolvemos su resultado.
  const result = inlineResults.get(id);
  inlineResults.delete(id);
  if (result) return result;
  const final = await prisma.campaign.findFirst({ where: { id, businessId } });
  return {
    ...(final ?? campaign),
    envio: { enviados: final?.sentCount ?? 0, fallidos: 0, canalSoportado: isSupportedChannel(campaign.channel) },
  };
}

function isSupportedChannel(channel: string): boolean {
  // Canales con envío saliente real hoy: WhatsApp y Email.
  return channel === 'whatsapp' || channel === 'email';
}

/**
 * Handler del job: ejecuta el envío completo. Un error inesperado se relanza
 * mientras queden intentos (BullMQ reintenta y se retoma desde el cursor); al
 * agotarlos la campaña pasa a 'failed' en vez de quedar 'sending' para siempre.
 */
async function runCampaignJob({ businessId, id, message }: CampaignJob): Promise<void> {
  const key = cursorKey(businessId, id);
  const prev = (await sharedGet<Cursor>(key)) ?? { processed: 0, enviados: 0, fallidos: 0, tries: 0 };
  const cursor: Cursor = { ...prev, tries: prev.tries + 1 };
  await sharedSet(key, cursor, CURSOR_TTL_MS);

  try {
    const result = await deliverCampaign(businessId, id, message, cursor);
    inlineResults.set(id, result);
    await sharedDel(key);
  } catch (err) {
    console.error(`[Campaigns] envío de ${id} falló (intento ${cursor.tries}/${MAX_ATTEMPTS}):`, describeError(err));
    if (cursor.tries < MAX_ATTEMPTS) throw err; // BullMQ reintenta (inline: no hay reintento)
    await prisma.campaign
      .updateMany({ where: { id, businessId }, data: { status: 'failed', sentCount: cursor.enviados } })
      .catch(() => undefined);
    await sharedDel(key);
  }
}

defineQueue<CampaignJob>(CAMPAIGN_QUEUE, runCampaignJob, { concurrency: 2 });

/** Envía a todos los destinatarios (retomando desde `cursor`) y cierra la campaña. */
async function deliverCampaign(
  businessId: string,
  id: string,
  message: string | undefined,
  cursor: Cursor,
): Promise<SendCampaignResult> {
  const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
  if (!campaign) throw new AppError(404, 'Campaign not found');

  const body = message?.trim() || campaign.description || campaign.name;
  const subject = campaign.name;
  const channel = campaign.channel;
  const soportado = isSupportedChannel(channel);

  // Destinatarios: clientes del negocio con al menos una reserva (scoped). Los ids
  // se ordenan para que el cursor (cantidad procesada) sea estable entre intentos.
  const bookings = await prisma.booking.findMany({
    where: { businessId },
    select: { clientId: true },
    distinct: ['clientId'],
  });
  const clientIds = bookings.map((b) => b.clientId).sort();

  if (!soportado) {
    cursor.fallidos = clientIds.length;
  } else {
    const senderNumber = channel === 'whatsapp' ? await resolveBusinessSender(businessId) : undefined;
    const waReady = channel === 'whatsapp' ? whatsapp.isConfigured() : true;
    const key = cursorKey(businessId, id);

    // Por lotes de ids; dentro de cada lote, orden por id: el orden global es
    // determinista, así `cursor.processed` (destinatarios ya tratados) identifica
    // dónde retomar. Al reintentar se vuelven a consultar los lotes (barato) y se
    // saltean las filas ya tratadas.
    let index = 0;
    for (let start = 0; start < clientIds.length; start += RECIPIENT_BATCH) {
      const batchIds = clientIds.slice(start, start + RECIPIENT_BATCH);
      const recipients = await prisma.user.findMany({
        where: { id: { in: batchIds }, businessId },
        select: { id: true, name: true, email: true, phone: true },
        orderBy: { id: 'asc' },
      });

      // Secuencial: evita ráfagas. Un fallo por destinatario se cuenta y NO corta.
      for (const r of recipients) {
        index++;
        if (index <= cursor.processed) continue; // ya enviado antes del corte

        try {
          if (channel === 'email') {
            if (!r.email) {
              cursor.fallidos++;
            } else if (await sendGenericNotification(r.email, subject, body)) {
              cursor.enviados++;
            } else {
              cursor.fallidos++;
            }
          } else if (!waReady || !r.phone) {
            cursor.fallidos++;
          } else {
            await whatsapp.sendMessage(r.phone, body, senderNumber);
            cursor.enviados++;
          }
        } catch (err) {
          cursor.fallidos++;
          console.error(`[Campaigns] Error enviando (canal ${channel}):`, describeError(err));
        }

        cursor.processed = index;
        await sharedSet(key, cursor, CURSOR_TTL_MS); // checkpoint por destinatario
        if (cursor.processed % PROGRESS_EVERY === 0) {
          await prisma.campaign.update({ where: { id }, data: { sentCount: cursor.enviados } });
        }
      }
    }
  }

  const { enviados, fallidos } = cursor;

  // Cierre: 'sent' + conteo final.
  const updated = await prisma.campaign.update({
    where: { id },
    data: { status: 'sent', sentCount: enviados },
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
