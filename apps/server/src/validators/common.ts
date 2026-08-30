import { z } from 'zod';

/**
 * Esquema compartido para paginación en endpoints de listado.
 * Se valida contra req.query (los valores llegan como string).
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/** Convierte page/pageSize en skip/take para Prisma. */
export function toSkipTake(pagination: PaginationInput) {
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  };
}
