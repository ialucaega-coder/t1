/**
 * Purga por TTL de las filas `Connection` descartables que se acumulan sin fin:
 *
 *  - OTP de reservas (`BOOKING_OTP`): cada código vive 10 min, pero solo se borra
 *    cuando el mismo teléfono lo reemplaza o lo verifica. Los que nadie usó
 *    quedaban para siempre.
 *  - Idempotencia (`*_IDEMPOTENCY`): una fila por cada pedido/cobro/orden de Mr Go
 *    con `Idempotency-Key`. Solo sirven para deduplicar reintentos cercanos.
 *
 * Todas son `Connection` ocultas (isActive=false) y todas comparten la tabla con
 * las configuraciones reales de los negocios; el `type` y `isActive=false`
 * acotan la purga, y un `LIMIT` por tanda evita transacciones largas.
 *
 * `Connection` no tiene `createdAt` (schema congelado). Para la idempotencia usamos
 * la fecha embebida en el id: Prisma genera cuid v1 (`c` + timestamp en base36 de
 * 8 caracteres + ...), que ordena cronológicamente. Se exige el formato del id para
 * no tocar jamás una fila con otro tipo de id.
 */
import { prisma } from '../../lib/prisma';
import {
  IDEMP_TYPE_MRGO,
  IDEMP_TYPE_ORDER,
  IDEMP_TYPE_TRANSACTION,
} from '../../lib/idempotency';

const OTP_TYPE = 'BOOKING_OTP'; // mismo valor que lib/otp.ts
const IDEMPOTENCY_TYPES = [IDEMP_TYPE_ORDER, IDEMP_TYPE_TRANSACTION, IDEMP_TYPE_MRGO];

/** Un OTP vencido se conserva 1 h más (margen para el error "expirado" en vez de "no existe"). */
const OTP_GRACE_MS = 60 * 60 * 1000;
const DEFAULT_IDEMPOTENCY_TTL_DAYS = 30;

const BATCH_SIZE = 1000;
const MAX_BATCHES = 50; // tope por corrida: 50k filas, el resto cae al día siguiente

function idempotencyTtlMs(): number {
  const days = Number(process.env.IDEMPOTENCY_TTL_DAYS);
  return (Number.isFinite(days) && days >= 1 ? days : DEFAULT_IDEMPOTENCY_TTL_DAYS) * 24 * 60 * 60 * 1000;
}

/** Id cuid "mínimo" para un instante: todo id anterior a ese instante es menor. */
export function cuidCutoffId(ms: number): string {
  return 'c' + Math.max(0, Math.floor(ms)).toString(36).padStart(8, '0');
}

async function deleteInBatches(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await run();
    total += n;
    if (n < BATCH_SIZE) break;
  }
  return total;
}

/** Borra los OTP vencidos hace más de 1 h. Devuelve cuántos borró. */
export async function purgeExpiredOtps(now: number = Date.now()): Promise<number> {
  const limit = now - OTP_GRACE_MS;
  return deleteInBatches(() =>
    prisma.$executeRaw`
      DELETE FROM "connections" WHERE id IN (
        SELECT id FROM "connections"
        WHERE type = ${OTP_TYPE} AND "isActive" = false
          AND CASE WHEN (config->>'expiresAt') ~ '^[0-9]{1,15}$'
                   THEN (config->>'expiresAt')::bigint END < ${limit}
        LIMIT ${BATCH_SIZE}
      )`,
  );
}

/** Borra las claves de idempotencia más viejas que el TTL (30 días por defecto). */
export async function purgeOldIdempotencyKeys(now: number = Date.now()): Promise<number> {
  const cutoffId = cuidCutoffId(now - idempotencyTtlMs());
  return deleteInBatches(() =>
    prisma.$executeRaw`
      DELETE FROM "connections" WHERE id IN (
        SELECT id FROM "connections"
        WHERE type = ANY(${IDEMPOTENCY_TYPES}) AND "isActive" = false
          AND id ~ '^c[0-9a-z]{24}$' AND id < ${cutoffId}
        LIMIT ${BATCH_SIZE}
      )`,
  );
}

export interface PurgeSummary {
  otps: number;
  idempotency: number;
}

/** Corre todas las purgas. Cada una falla por separado sin frenar a la otra. */
export async function runPurge(now: number = Date.now()): Promise<PurgeSummary> {
  const summary: PurgeSummary = { otps: 0, idempotency: 0 };
  try {
    summary.otps = await purgeExpiredOtps(now);
  } catch (err) {
    console.error('[purge] OTP vencidos:', err);
  }
  try {
    summary.idempotency = await purgeOldIdempotencyKeys(now);
  } catch (err) {
    console.error('[purge] claves de idempotencia:', err);
  }
  if (summary.otps || summary.idempotency) {
    console.log(`[purge] borrados ${summary.otps} OTP vencidos y ${summary.idempotency} claves de idempotencia viejas`);
  }
  return summary;
}
