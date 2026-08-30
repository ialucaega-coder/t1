import { z } from 'zod';

/** Creación de un producto. */
export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  stock: z.number().int().min(0).default(0),
  categoryId: z.string().optional(),
  isActive: z.boolean().default(true),
});

/** Actualización parcial de un producto. */
export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
