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
 *   2. Un fallo DENTRO de `processMessage` (guardar el mensaje USER, generar y
 *      guardar la respuesta) → se reintenta SOLO si no quedó nada persistido para
 *      ese contacto desde que arrancó el trabajo (`wasAnythingPersisted`). Si ya
 *      se guardó algo (el USER o la respuesta) NO se reintenta: se duplicaría el
 *      mensaje del cliente y el bot volvería a generar (costo de IA).
 *      Si no se puede averiguar (la DB sigue caída), se reintenta: el peor caso es
 *      una fila USER repetida en el historial, nunca un mensaje repetido al cliente
 *      (nada salió todavía).
 *   3. Un fallo DESPUÉS de que `processMessage` devolvió (el envío al proveedor) →
 *      NO se reintenta, solo se loguea: la respuesta ya está guardada y visible en
 *      el Inbox; reintentar regeneraría la respuesta y podría mandarla dos veces.
 *
 * Dedupe: el reintento de BullMQ conserva el `jobId` (messageSid / mid), y encolar
 * dos veces el mismo id lo ejecuta una sola vez; el reintento del proveedor
 * (Twilio/Meta) del mismo mensaje no se procesa dos veces.
 *
 * LIMITACIÓN conocida: el mensaje USER lo guarda `processMessage` y hoy no recibe
 * el id de entrada, así que no queda marcado con el messageSid/mid; la protección
 * contra doble guardado es el chequeo de (2) + el dedupe por jobId. Marcar
 * `Message.metadata.externalId` requiere una opción nueva en `processMessage`.
 */
import { prisma } from '../../lib/prisma';

/** Intentos totales y espera base (backoff exponencial) de los jobs entrantes. */
export const INBOUND_RETRY = { attempts: 3, backoffMs: 2000 };

/** Holgura para diferencias de reloj entre el server y la DB. */
const CLOCK_SKEW_MS = 5000;

/**
 * ¿Se guardó algún mensaje para este contacto del negocio desde `sinceMs`? Se
 * scopea por `businessId` y por `contactPhone` (teléfono de WhatsApp / id de Meta).
 */
export async function wasAnythingPersisted(
  businessId: string,
  contactPhone: string,
  sinceMs: number,
): Promise<boolean> {
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
  ctx: { businessId: string; contact: string },
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
      persisted = await wasAnythingPersisted(ctx.businessId, ctx.contact, startedAt);
    } catch {
      persisted = false; // no se pudo averiguar: se prefiere reintentar a perder el mensaje
    }
    if (persisted) {
      console.error(`${label}: falló con mensajes ya guardados (no se reintenta para no duplicar):`, error);
      return;
    }
    console.error(`${label}: falló antes de guardar nada, se reintenta:`, (error as Error)?.message);
    throw error;
  }
}
