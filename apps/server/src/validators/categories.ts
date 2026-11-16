import { z } from 'zod';
import { patchSchema } from './patch';

/** Creación de una categoría. */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(80, 'El nombre no puede superar los 80 caracteres'),
  icon: z.string().max(64).optional(),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

/** Actualización parcial de una categoría. */
export const updateCategorySchema = patchSchema(createCategorySchema);

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
