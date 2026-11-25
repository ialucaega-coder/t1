/**
 * Lock de creación para las filas `Connection` "singleton" (una por negocio y
 * type: CRM, brand, FAQ, permisos, revocación, etc.).
 *
 * Todas siguen el mismo patrón dentro de una transacción: `findFirst` y, si no
 * hay fila, `create`. Sin serializar, dos requests simultáneos del primer uso
 * (dos tabs, dos miembros del equipo) ven "no existe" y crean DOS filas. Los
 * lectores toman la de id menor (`orderBy id asc`), así que lo guardado en la
 * otra se pierde en silencio.
 *
 * El schema está congelado (no hay UNIQUE parcial por `(businessId, type)`), así
 * que serializamos con un advisory lock transaccional por (negocio, type). Se
 * libera solo al terminar la transacción. Debe llamarse ANTES del `findFirst`.
 * El lock se toma siempre (no solo cuando falta la fila): es barato y evita una
 * lectura previa que otra transacción en vuelo aún no puede ver.
 */
import type { Prisma } from '@prisma/client';

export function singletonLockKey(businessId: string, type: string): string {
  return `conn-singleton:${type}:${businessId}`;
}

export async function lockSingleton(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  businessId: string,
  type: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${singletonLockKey(businessId, type)}, 0))`;
}
