import { z } from 'zod';

/** Filtros de búsqueda y paginación para el listado de clientes. */
export const listClientsQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Actualización de los datos de un cliente por parte de un administrador. */
export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  avatar: z.string().url().optional(),
});

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
