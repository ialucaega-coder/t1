/**
 * Topes para los mapas por cliente que viven en un único JSON por negocio
 * (`CLIENT_CRM`, `CRM_LIFECYCLE`).
 *
 * Cada guardado reescribe el JSON entero bajo lock de fila, así que su costo
 * crece con la cantidad de entradas. Los topes son holgados (un negocio normal ni
 * se acerca) y solo se evalúan cuando un guardado AGREGA una entrada nueva: nunca
 * recortamos datos existentes. Antes de rechazar, se podan las entradas huérfanas
 * (clientes borrados o que ya no son del negocio), que son el crecimiento "gratis".
 *
 * Si un negocio llega al tope de verdad, la salida es migrar a filas hijas por
 * cliente (requiere descongelar el schema; ver docs/ESCALABILIDAD.md, 6.4).
 */
import type { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';

export const MAX_CRM_CLIENTS = 10_000;
export const MAX_LIFECYCLE_CLIENTS = 20_000;

const CHUNK = 2_000;

/**
 * De los `ids` dados, devuelve los que siguen siendo clientes activos del negocio.
 * Consulta en tandas para no armar un `IN (...)` gigante.
 */
export async function activeClientIds(
  db: Pick<Prisma.TransactionClient, 'user'>,
  businessId: string,
  ids: string[],
): Promise<Set<string>> {
  const alive = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db.user.findMany({
      where: { businessId, role: 'CLIENT', deletedAt: null, id: { in: ids.slice(i, i + CHUNK) } },
      select: { id: true },
    });
    for (const r of rows) alive.add(r.id);
  }
  return alive;
}

/**
 * Aplica el tope a un mapa por cliente que acaba de crecer. Si supera `max`,
 * poda los huérfanos; si aún así no entra, rechaza con un 409 claro.
 * Devuelve el mapa (posiblemente podado). `protectedId` (el cliente que se está
 * guardando recién) nunca se poda.
 */
export async function enforceClientMapLimit<T>(
  db: Pick<Prisma.TransactionClient, 'user'>,
  businessId: string,
  map: Record<string, T>,
  max: number,
  protectedId: string,
  what: string,
): Promise<Record<string, T>> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;

  const alive = await activeClientIds(db, businessId, keys);
  const pruned: Record<string, T> = {};
  for (const k of keys) {
    if (alive.has(k) || k === protectedId) pruned[k] = map[k];
  }
  if (Object.keys(pruned).length > max) {
    throw new AppError(
      409,
      `Llegaste al límite de ${max.toLocaleString('es-AR')} clientes con ${what}. Para seguir, depurá los que ya no uses.`,
    );
  }
  return pruned;
}
