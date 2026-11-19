import { z } from 'zod';
import { imageUrlSchema } from './image-url';

/** Topes de los datos de un cliente (evitan payloads enormes y errores opacos de la base). */
export const CLIENT_NAME_MAX = 100;
export const CLIENT_EMAIL_MAX = 254;
export const CLIENT_PHONE_MAX = 30;

const clientName = z.string().trim().min(2).max(CLIENT_NAME_MAX);

/** Teléfono: recortado, hasta 30 caracteres; vacío = sin teléfono (null). */
const clientPhone = z
  .string()
  .trim()
  .max(CLIENT_PHONE_MAX)
  .transform((v) => (v === '' ? null : v));

/** Filtros de búsqueda y paginación para el listado de clientes. */
export const listClientsQuerySchema = z.object({
  search: z.string().trim().optional(),
  /** Filtro por etiqueta del CRM (id de tag). Segmenta la lista. */
  tagId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Actualización de los datos de un cliente por parte de un administrador. */
export const updateClientSchema = z.object({
  name: clientName.optional(),
  // '' o null borran el teléfono (antes el front no podía vaciarlo).
  phone: clientPhone.nullable().optional(),
  // Solo https (se muestra en un <img> del panel).
  avatar: imageUrlSchema.nullable().optional(),
});

/** Alta de un cliente. El email se normaliza a minúsculas: el login también compara en minúsculas. */
export const createClientSchema = z.object({
  name: clientName,
  email: z.string().trim().max(CLIENT_EMAIL_MAX).email().transform((e) => e.toLowerCase()),
  phone: clientPhone.optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
