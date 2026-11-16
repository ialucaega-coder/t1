import { z } from 'zod';
import { patchSchema } from './patch';
import { imageUrlSchema, sortOrderSchema } from './image-url';

/** Creación de un producto. */
export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: z.number().positive(),
  stock: z.number().int().min(0).default(0),
  // null = sin categoría (permite quitarla al editar).
  categoryId: z.string().nullable().optional(),
  // null = sin imagen (permite quitarla al editar).
  image: imageUrlSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  isActive: z.boolean().default(true),
});

/** Actualización parcial de un producto. */
export const updateProductSchema = patchSchema(createProductSchema);

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
