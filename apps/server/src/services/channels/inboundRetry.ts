/**
 * Criterio de reintento de los mensajes ENTRANTES (colas whatsapp-inbound,
 * meta-inbound y telegram-update).
 *
 * Problema: los handlers capturaban TODO error y nunca reintentaban, así que un
 * fallo transitorio (DB un instante caída) PERDÍA el mensaje del cliente. Pero
 * reintentar a ciegas puede duplicar: si el bot ya respondió, un reintento volvería
 * a contestarle al cliente.
 *
 * Criterio (documentado y testeado):
 *
 *   1. Un fallo ANTES de procesar el mensaje (leer la conversación, adjuntos, el
 *      negocio) → se RELANZA: la cola reintenta con backoff exponencial.
 *   2. Un fallo DENTRO de `processMessage` → se reintenta salvo que el bot YA haya
 *      respondido (`wasAnythingPersisted`):
 *        - Con `externalId` (MessageSid / mid): el mensaje USER se guarda con ese id
 *          en `Message.metadata.externalId` y `processMessage` es idempotente sobre
 *          él, así que reintentar cuando solo quedó el USER es SEGURO (no se
 *          duplica; el reintento continúa y genera la respuesta). Solo NO se
 *          reintenta si ya existe una respuesta BOT posterior a ese USER.
 *        - Sin `externalId` (canal que no lo trae): criterio conservador previo, no
 *          se reintenta si hay cualquier mensaje del contacto desde que arrancó.
 *      Si no se puede averiguar (la DB sigue caída), se reintenta: el peor caso es
 *      una fila repetida en el historial, nunca un mensaje repetido al cliente
 *      (nada salió todavía).
 *   3. Un fallo DESPUÉS de que `processMessage` devolvió (el envío al proveedor) →
 *      NO se reintenta, solo se loguea: la respuesta ya está guardada y visible en
 *      el Inbox; reintentar regeneraría la respuesta y podría mandarla dos veces.
 *
 * Dedupe: el reintento de BullMQ conserva el `jobId` (messageSid / mid), y encolar
 * dos veces el mismo id lo ejecuta una sola vez; el reintento del proveedor
 * (Twilio/Meta) del mismo mensaje no se procesa dos veces.
 */
import { prisma } from '../../lib/prisma';

/** Intentos totales y espera base (backoff exponencial) de los jobs entrantes. */
export const INBOUND_RETRY = { attempts: 3, backoffMs: 2000 };

/** Holgura para diferencias de reloj entre el server y la DB. */
const CLOCK_SKEW_MS = 5000;

/**
 * ¿Ya quedó una respuesta del bot para este mensaje entrante (no conviene
 * reintentar)? Con `externalId`: busca el USER con ese id en una conversación DEL
 * NEGOCIO y mira si hay un BOT posterior; sin USER guardado o sin BOT todavía es
 * seguro reintentar (el USER no se duplica). Sin `externalId` cae al criterio
 * conservador: cualquier mensaje del contacto desde `sinceMs`.
 */
export async function wasAnythingPersisted(
  businessId: string,
  contactPhone: string,
  sinceMs: number,
  externalId?: string,
): Promise<boolean> {
  if (externalId) {
    const user = await prisma.message.findFirst({
      where: {
        role: 'USER',
        metadata: { path: ['externalId'], equals: externalId },
        conversation: { businessId },
      },
      select: { conversationId: true, createdAt: true },
    });
    if (!user) return false;
    const answered = await prisma.message.findFirst({
      where: { conversationId: user.conversationId, role: 'BOT', createdAt: { gte: user.createdAt } },
      select: { id: true },
    });
    return Boolean(answered);
  }

  const row = await prisma.message.findFirst({
    where: {
      createdAt: { gte: new Date(sinceMs - CLOCK_SKEW_MS) },
      conversation: { businessId, contactPhone },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/** Marcas que el handler le pasa a `runInbound` para delimitar las fases. */
export interface InboundPhase {
  /** Llamar apenas `processMessage` devolvió: de acá en más un fallo NO se reintenta. */
  processed(): void;
}

/**
 * Ejecuta el trabajo de un mensaje entrante aplicando el criterio de arriba:
 * relanza (→ reintento de la cola) solo los fallos seguros de reintentar y traga
 * (con log) el resto. `contact` es el id del contacto tal como se guarda en
 * `Conversation.contactPhone`.
 */
export async function runInbound(
  label: string,
  ctx: { businessId: string; contact: string; externalId?: string },
  work: (phase: InboundPhase) => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  let processed = false;

  try {
    await work({
      processed: () => {
        processed = true;
      },
    });
  } catch (error) {
    if (processed) {
      // 3) Falló el envío (o algo posterior): la respuesta ya está guardada.
      console.error(`${label}: falló después de procesar el mensaje (no se reintenta):`, error);
      return;
    }

    // 1) y 2) Falló antes de terminar de procesar. ¿Quedó algo guardado?
    let persisted = false;
    try {
      persisted = await wasAnythingPersisted(ctx.businessId, ctx.contact, startedAt, ctx.externalId);
    } catch {
      persisted = false; // no se pudo averiguar: se prefiere reintentar a perder el mensaje
    }
    if (persisted) {
      console.error(`${label}: falló con la respuesta ya guardada (no se reintenta para no duplicar):`, error);
      return;
    }
    console.error(`${label}: falló antes de guardar nada, se reintenta:`, (error as Error)?.message);
    throw error;
  }
}
