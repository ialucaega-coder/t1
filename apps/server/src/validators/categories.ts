import { z } from 'zod';
import { patchSchema } from './patch';

/** Creación de una categoría. */
export const createCategorySchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

/** Actualización parcial de una categoría. */
export const updateCategorySchema = patchSchema(createCategorySchema);

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
