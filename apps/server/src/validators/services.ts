import { z } from 'zod';
import { patchSchema } from './patch';
import { imageUrlSchema, sortOrderSchema } from './image-url';

/** Creación de un servicio. */
export const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  duration: z.number().int().positive(),
  price: z.number().positive(),
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
