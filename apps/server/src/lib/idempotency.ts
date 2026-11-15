/**
 * Idempotencia sin cambios de schema, sobre la tabla Connection.
 *
 * Cada operación idempotente (crear pedido, registrar cobro) guarda una fila
 * Connection oculta (isActive:false) con `config { key, entityId }` y un `type`
 * que actúa de "scope" (ORDER_IDEMPOTENCY, TRANSACTION_IDEMPOTENCY, …). Así una
 * Idempotency-Key repetida (doble-submit / reintento de red) resuelve a la
 * misma entidad en vez de duplicarla, sin contaminar campos visibles del
 * dominio ni requerir una tabla nueva.
 *
 * Uso típico en una ruta:
 *   const key = readIdempotencyKey(req.header('Idempotency-Key'));
 *   if (key) { const id = await findIdempotentEntityId(prisma, biz, TYPE, key);
 *              if (id) return res.json(await load(id)); }
 *   const entity = await prisma.$transaction(async (tx) => {
 *     if (key) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(TYPE, biz, key)}, 0))`;
 *                const dup = await findIdempotentEntityId(tx, biz, TYPE, key);
 *                if (dup) return { existing: dup }; }
 *     const created = await tx.entity.create(...);
 *     if (key) await recordIdempotentKey(tx, biz, TYPE, key, created.id);
 *     return { created };
 *   });
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Scopes (van en Connection.type). Uno por tipo de operación idempotente. */
export const IDEMP_TYPE_ORDER = 'ORDER_IDEMPOTENCY';
export const IDEMP_TYPE_TRANSACTION = 'TRANSACTION_IDEMPOTENCY';
export const IDEMP_TYPE_MRGO = 'MRGO_IDEMPOTENCY';

/**
 * Cliente Prisma o transacción. TransactionClient acepta tanto `prisma` (que
 * tiene de más) como el `tx` de $transaction, y expone el delegate `connection`.
 */
type ConnectionDb = Prisma.TransactionClient;

/** Normaliza el header Idempotency-Key (recortado, o null si vacío). */
export function readIdempotencyKey(header: string | undefined): string | null {
  return (header || '').trim().slice(0, 200) || null;
}

/** Clave del advisory lock para serializar duplicados concurrentes. */
export function idempotencyLockKey(type: string, businessId: string, key: string): string {
  return `idemp:${type}:${businessId}:${key}`;
}

/** Devuelve el id de la entidad ya creada para esta clave, o null. */
export async function findIdempotentEntityId(
  db: ConnectionDb,
  businessId: string,
  type: string,
  key: string,
): Promise<string | null> {
  const conn = await db.connection.findFirst({
    where: { businessId, type, config: { path: ['key'], equals: key } },
    select: { config: true },
  });
  return (conn?.config as { entityId?: string } | null)?.entityId ?? null;
}

/** Registra la clave → entidad para deduplicar futuros reintentos. */
export async function recordIdempotentKey(
  db: ConnectionDb,
  businessId: string,
  type: string,
  key: string,
  entityId: string,
): Promise<void> {
  await db.connection.create({
    data: {
      name: 'Idempotencia',
      type,
      icon: 'Key',
      isActive: false,
      config: { key, entityId } as Prisma.InputJsonObject,
      businessId,
    },
  });
}

/**
 * Reserva la clave de forma atómica ANTES de ejecutar una operación con efectos
 * externos (semántica at-most-once). Devuelve `true` si esta llamada la tomó y
 * `false` si ya estaba tomada (reintento o doble envío). El advisory lock
 * serializa duplicados concurrentes de la misma clave. La clave queda consumida
 * aunque la operación falle: un reintento legítimo debe usar una clave nueva.
 */
export async function claimIdempotentKey(
  client: Pick<PrismaClient, '$transaction'>,
  businessId: string,
  type: string,
  key: string,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(type, businessId, key)}, 0))`;
    const dup = await findIdempotentEntityId(tx, businessId, type, key);
    if (dup) return false;
    await recordIdempotentKey(tx, businessId, type, key, 'claimed');
    return true;
  });
}


/**
 * Libera una clave reservada con `claimIdempotentKey` cuando la operación NO
 * llegó a ejecutarse (ej. falló el guardado previo al efecto externo), para que
 * un reintento con la misma clave no quede bloqueado como duplicado. Nunca lanza.
 * Solo usarla si no hubo efecto externo: si el mensaje ya salió, la clave debe quedar.
 */
export async function releaseIdempotentKey(
  db: ConnectionDb,
  businessId: string,
  type: string,
  key: string,
): Promise<void> {
  try {
    await db.connection.deleteMany({
      where: { businessId, type, config: { path: ['key'], equals: key } },
    });
  } catch (err) {
    console.error('No se pudo liberar la clave de idempotencia:', (err as Error).message);
  }
}
