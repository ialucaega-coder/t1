import { z } from 'zod';
import { patchSchema } from './patch';
import { imageUrlSchema, sortOrderSchema } from './image-url';
import { MAX_PRICE } from './products';

/** Duración máxima de un servicio: un día (1440 min). */
export const MAX_DURATION_MIN = 1440;

/** Creación de un servicio. */
export const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  duration: z
    .number()
    .int('La duración debe ser un número entero de minutos')
    .positive('La duración debe ser mayor a 0')
    .max(MAX_DURATION_MIN, 'La duración no puede superar 1440 minutos (24 h)'),
  price: z
    .number()
    .positive('El precio debe ser mayor a 0')
    .max(MAX_PRICE, 'El precio no puede superar 99.999.999,99'),
  // null = sin categoría (permite quitarla al editar).
  categoryId: z.string().nullable().optional(),
  // null = sin imagen (permite quitarla al editar).
  image: imageUrlSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  isActive: z.boolean().default(true),
});

/** Actualización parcial de un servicio. */
export const updateServiceSchema = patchSchema(createServiceSchema);

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
