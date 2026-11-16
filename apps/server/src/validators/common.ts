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

/**
 * Regla única para el nombre de un negocio. Ese nombre se muestra en mails que salen
 * del dominio oficial (invitaciones), widgets y cabeceras, así que se acota a 80
 * caracteres y se rechazan saltos de línea y caracteres de control/formato
 * (bidi, ancho cero, etc.) que permiten armar textos de phishing.
 * Se usa en registro (min 2), configuración y white label (min 1, como antes).
 */
export const businessNameSchema = (min = 2) =>
  z
    .string()
    .trim()
    .min(min)
    .max(80, 'El nombre del negocio no puede superar los 80 caracteres')
    .regex(/^[^\p{Cc}\p{Cf}\u2028\u2029]+$/u, 'El nombre del negocio no puede tener saltos de línea ni caracteres de control');
