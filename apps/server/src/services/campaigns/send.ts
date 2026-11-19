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
import { emitCampaignFailed, emitCampaignProgress } from './events';

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
/**
 * Latido del envío: cada tanto (no solo cada 25 destinatarios) se toca `updatedAt`
 * de la campaña para que el reaper no confunda un envío lento pero vivo con uno
 * trabado. Bien por debajo de STALLED_SENDING_MS.
 */
const HEARTBEAT_MS = 60 * 1000;

interface CampaignJob {
  businessId: string;
  id: string;
  message?: string;
  /**
   * Identidad de ESTE envío. Si la campaña se reenvía (p. ej. después de que el
   * reaper la marcó failed), el job viejo que quedó en la cola ya no es el vigente y
   * se corta solo en vez de duplicar mensajes. Los jobs sin runId (encolados por una
   * versión anterior) se consideran vigentes.
   */
  runId?: string;
}

/** El envío quedó obsoleto (campaña ya no 'sending' o reemplazado por otro envío): se corta sin reintentar. */
class StaleCampaignRun extends Error {
  constructor() {
    super('stale campaign run');
    this.name = 'StaleCampaignRun';
  }
}

/** Progreso persistido (Redis/memoria) para poder retomar un envío interrumpido. */
interface Cursor {
  processed: number;
  enviados: number;
  fallidos: number;
  tries: number;
}

// El cursor y la marca del envío vigente van por runId: un job viejo que sigue vivo
// nunca pisa ni borra el progreso del envío nuevo (antes compartían la misma clave).
const cursorKey = (businessId: string, id: string, runId?: string) =>
  `campaign:${businessId}:${id}${runId ? `:${runId}` : ''}:cursor`;
const runKey = (businessId: string, id: string) => `campaign:${businessId}:${id}:run`;

/** ¿Este job es el envío vigente de la campaña? Sin marca en el estado compartido se asume que sí. */
async function isCurrentRun(businessId: string, id: string, runId?: string): Promise<boolean> {
  if (!runId) return true;
  const current = await sharedGet<string>(runKey(businessId, id));
  return !current || current === runId;
}

/**
 * Corta el envío si ya no es el vigente o la campaña dejó de estar 'sending'
 * (reaper -> failed, cancelada, borrada, reenviada). Se llama antes de cada lote.
 */
async function assertRunActive(businessId: string, id: string, runId?: string): Promise<void> {
  if (!(await isCurrentRun(businessId, id, runId))) throw new StaleCampaignRun();
  const row = await prisma.campaign.findFirst({ where: { id, businessId, status: 'sending' }, select: { id: true } });
  if (!row) throw new StaleCampaignRun();
}

/**
 * Resultado del último envío inline (sin Redis) para devolverlo al caller.
 * Solo se guarda si `sendCampaign` lo está esperando (`inlineWanted`): antes el
 * worker lo escribía SIEMPRE y con colas reales nadie lo borraba (el Map crecía
 * una entrada por campaña enviada).
 */
const inlineResults = new Map<string, SendCampaignResult>();
const inlineWanted = new Set<string>();

export interface SendCampaignOptions {
  /**
   * Disparo por el scheduler: el claim exige status 'scheduled' (no pisa una
   * campaña cancelada/editada entre el listado y el claim) y `scheduledAt` vencido.
   */
  scheduledOnly?: boolean;
}

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
  options: SendCampaignOptions = {},
): Promise<SendCampaignResult> {
  // Claim ATÓMICO: pasa a 'sending' solo si NO estaba ya 'sent' ni 'sending'
  // (ni 'cancelled': una campaña cancelada no se envía; el scheduler además exige
  // 'scheduled' con fecha vencida).
  const claim = await prisma.campaign.updateMany({
    where: options.scheduledOnly
      ? { id, businessId, status: 'scheduled', scheduledAt: { lte: new Date() } }
      : { id, businessId, status: { notIn: ['sent', 'sending', 'cancelled'] } },
    data: { status: 'sending' },
  });
  if (claim.count === 0) {
    const exists = await prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true } });
    throw new AppError(exists ? 400 : 404, exists ? 'Campaign already sent' : 'Campaign not found');
  }

  // Desde acá la campaña está en 'sending': si algo lanza (leer la campaña, encolar,
  // el job inline) NO puede quedar así para siempre sin que nadie la termine.
  try {
    const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
    if (!campaign) throw new AppError(404, 'Campaign not found'); // defensivo: no debería ocurrir tras el claim

    // Envío nuevo: runId propio (cursor propio, vacío). NO se borra el cursor de otro
    // envío: si hay un job viejo aún vivo, conserva el suyo y se corta al ver que ya
    // no es el vigente.
    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await sharedSet(runKey(businessId, id), runId, CURSOR_TTL_MS);

    inlineWanted.add(id);
    const how = await enqueue<CampaignJob>(
      CAMPAIGN_QUEUE,
      { businessId, id, message, runId },
      // El dedupe de doble disparo ya lo hace el claim atómico de arriba; el jobId es
      // único por envío (si fuera fijo por campaña, reenviar una campaña 'failed'
      // chocaría con el job viejo retenido en la cola). Reintentos con backoff; cada
      // uno retoma desde el cursor.
      { jobId: `campaign_${id}_${Date.now()}`, attempts: MAX_ATTEMPTS, backoffMs: 5000 },
    );

    inlineWanted.delete(id);
    if (how === 'queued') {
      inlineResults.delete(id); // el worker (otro proceso o este) no debe dejar basura
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
  } catch (err) {
    inlineWanted.delete(id);
    inlineResults.delete(id);
    await failAfterClaim(businessId, id);
    throw err;
  }
}

/** Sin avance (updatedAt) por más de esto, una campaña 'sending' se considera trabada. */
export const STALLED_SENDING_MS = 30 * 60 * 1000;
const STALLED_BATCH = 50;

/**
 * Una excepción posterior al claim deja la campaña en 'failed' (antes quedaba
 * 'sending' para siempre y ni el scheduler ni el usuario podían reenviarla).
 * Solo toca filas que siguen 'sending' (no pisa un 'sent' ya cerrado). Nunca lanza.
 */
async function failAfterClaim(businessId: string, id: string): Promise<void> {
  try {
    const upd = await prisma.campaign.updateMany({
      where: { id, businessId, status: 'sending' },
      data: { status: 'failed' },
    });
    if (upd.count > 0) await emitCampaignFailed(businessId, id, 'error');
  } catch {
    /* el reaper (failStalledCampaigns) lo recoge más tarde */
  }
}

/**
 * Reaper: pasa a 'failed' las campañas 'sending' sin avance hace más de 30 min
 * (proceso caído a mitad de un envío, job perdido). El progreso toca `updatedAt`
 * (sentCount cada 25 destinatarios), así que un envío vivo no se marca. Lo llama el
 * scheduler en cada tick (`dispatchDueCampaigns`). Devuelve cuántas marcó.
 */
export async function failStalledCampaigns(now: Date = new Date()): Promise<number> {
  const stalled = await prisma.campaign.findMany({
    where: { status: 'sending', updatedAt: { lt: new Date(now.getTime() - STALLED_SENDING_MS) } },
    select: { id: true, businessId: true, updatedAt: true },
    take: STALLED_BATCH,
  });
  let failed = 0;
  for (const c of stalled) {
    // Con el updatedAt leído en el WHERE: si avanzó entre el listado y acá, no se pisa.
    const upd = await prisma.campaign.updateMany({
      where: { id: c.id, businessId: c.businessId, status: 'sending', updatedAt: c.updatedAt },
      data: { status: 'failed' },
    });
    if (upd.count > 0) {
      failed++;
      await emitCampaignFailed(c.businessId, c.id, 'stalled');
    }
  }
  return failed;
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
async function runCampaignJob({ businessId, id, message, runId }: CampaignJob): Promise<void> {
  const key = cursorKey(businessId, id, runId);
  const prev = (await sharedGet<Cursor>(key)) ?? { processed: 0, enviados: 0, fallidos: 0, tries: 0 };
  const cursor: Cursor = { ...prev, tries: prev.tries + 1 };
  await sharedSet(key, cursor, CURSOR_TTL_MS);

  try {
    const result = await deliverCampaign(businessId, id, message, cursor, runId);
    if (inlineWanted.has(id)) inlineResults.set(id, result);
    await sharedDel(key);
  } catch (err) {
    if (err instanceof StaleCampaignRun) {
      // Obsoleto (reaper, cancelación o reenvío): no se reintenta ni se toca el estado de la campaña.
      console.warn(`[Campaigns] el envío de ${id} quedó obsoleto: se corta sin enviar más.`);
      await sharedDel(key);
      return;
    }
    console.error(`[Campaigns] envío de ${id} falló (intento ${cursor.tries}/${MAX_ATTEMPTS}):`, describeError(err));
    if (cursor.tries < MAX_ATTEMPTS) throw err; // BullMQ reintenta (inline: no hay reintento)
    // Solo si este sigue siendo el envío vigente (no se marca failed un envío nuevo).
    if (await isCurrentRun(businessId, id, runId)) {
      await prisma.campaign
        .updateMany({
          where: { id, businessId, status: 'sending' },
          data: { status: 'failed', sentCount: cursor.enviados },
        })
        .catch(() => undefined);
      await emitCampaignFailed(businessId, id, 'retries_exhausted', {
        enviados: cursor.enviados,
        fallidos: cursor.fallidos,
      });
    }
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
  runId?: string,
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
    const key = cursorKey(businessId, id, runId);
    let lastBeat = Date.now();

    // Por lotes de ids; dentro de cada lote, orden por id: el orden global es
    // determinista, así `cursor.processed` (destinatarios ya tratados) identifica
    // dónde retomar. Al reintentar se vuelven a consultar los lotes (barato) y se
    // saltean las filas ya tratadas.
    let index = 0;
    for (let start = 0; start < clientIds.length; start += RECIPIENT_BATCH) {
      // Antes de cada lote: la campaña tiene que seguir 'sending' y este job ser el vigente.
      await assertRunActive(businessId, id, runId);
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
        // Progreso + latido: cada 25 destinatarios O cada minuto (lo que ocurra primero).
        // Si la campaña ya no está 'sending' (count 0), este envío quedó obsoleto.
        if (cursor.processed % PROGRESS_EVERY === 0 || Date.now() - lastBeat >= HEARTBEAT_MS) {
          lastBeat = Date.now();
          const beat = await prisma.campaign.updateMany({
            where: { id, businessId, status: 'sending' },
            data: { sentCount: cursor.enviados },
          });
          if (beat.count === 0 || !(await isCurrentRun(businessId, id, runId))) throw new StaleCampaignRun();
          emitCampaignProgress(businessId, id, {
            enviados: cursor.enviados,
            fallidos: cursor.fallidos,
            procesados: cursor.processed,
            total: clientIds.length,
          });
        }
      }
    }
  }

  const { enviados, fallidos } = cursor;

  // Cierre: 'sent' + conteo final, SOLO si la campaña sigue 'sending' y este es el envío
  // vigente (antes era un update sin guarda que pisaba un 'failed'/'cancelled').
  if (!(await isCurrentRun(businessId, id, runId))) throw new StaleCampaignRun();
  let updated;
  try {
    updated = await prisma.campaign.update({
      where: { id, businessId, status: 'sending' },
      data: { status: 'sent', sentCount: enviados },
    });
  } catch (err) {
    // P2025: la campaña ya no estaba 'sending' (reaper, cancelación, borrado, reenvío).
    if ((err as { code?: string }).code === 'P2025') throw new StaleCampaignRun();
    throw err;
  }

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
