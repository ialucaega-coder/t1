import type { Request } from 'express';

/**
 * Helpers de paginación a nivel app.
 *
 * Objetivo: ofrecer una paginación consistente y retrocompatible para los
 * endpoints de listado. Parsea `page` y `limit` (o `offset`) desde `req.query`
 * aplicando defaults sanos y un tope máximo de `limit`, para evitar que un
 * cliente pida, por ejemplo, `?limit=100000` y tumbe la base de datos.
 */

/** Cantidad de elementos por página por defecto. */
export const DEFAULT_LIMIT = 20;

/** Tope máximo de `limit` permitido por request (protección anti-abuso). */
export const MAX_LIMIT = 100;

/** Parámetros normalizados listos para pasar a Prisma (`skip`/`take`). */
export interface PaginationParams {
  /** Registros a saltar (para `skip` de Prisma). */
  skip: number;
  /** Registros a traer (para `take` de Prisma). */
  take: number;
  /** Página actual (1-indexada). */
  page: number;
  /** Tamaño de página efectivo. */
  limit: number;
}

/** Forma estándar de una respuesta paginada. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Indica si el cliente pidió paginación explícitamente.
 * Sirve para mantener la retrocompatibilidad: si no viene ningún parámetro
 * de paginación, el endpoint puede seguir respondiendo como lo hacía antes.
 */
export function isPaginationRequested(query: Request['query']): boolean {
  return (
    query.page !== undefined ||
    query.limit !== undefined ||
    query.offset !== undefined
  );
}

/** Convierte un valor de query (string | string[] | undefined) a entero seguro. */
function toInt(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Parsea los parámetros de paginación desde `req.query`.
 *
 * Reglas:
 * - `limit` se acota al rango [1, maxLimit]; si es inválido usa `defaultLimit`.
 * - Si viene `offset`, tiene prioridad y se deriva la `page` a partir de él.
 * - Si no, se usa `page` (mínimo 1) y se calcula el `skip`.
 */
export function parsePagination(
  query: Request['query'],
  options?: { defaultLimit?: number; maxLimit?: number }
): PaginationParams {
  const maxLimit = options?.maxLimit ?? MAX_LIMIT;
  const defaultLimit = options?.defaultLimit ?? DEFAULT_LIMIT;

  let limit = toInt(query.limit, defaultLimit);
  if (limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  // `offset` explícito tiene prioridad sobre `page`.
  if (query.offset !== undefined) {
    let offset = toInt(query.offset, 0);
    if (offset < 0) offset = 0;
    const page = Math.floor(offset / limit) + 1;
    return { skip: offset, take: limit, page, limit };
  }

  let page = toInt(query.page, 1);
  if (page < 1) page = 1;

  return { skip: (page - 1) * limit, take: limit, page, limit };
}

/**
 * Arma la respuesta paginada estándar `{ data, total, page, limit, totalPages }`.
 * `totalPages` usa `Math.ceil` (0 cuando no hay resultados), igual que el
 * cálculo previo del proyecto.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: Pick<PaginationParams, 'page' | 'limit'>
): PaginatedResponse<T> {
  return {
    data,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}
