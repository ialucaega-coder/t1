import { z } from 'zod';

/** Creación de un servicio. */
export const createServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  duration: z.number().int().positive(),
  price: z.number().positive(),
  categoryId: z.string().optional(),
  isActive: z.boolean().default(true),
});

/** Actualización parcial de un servicio. */
export const updateServiceSchema = createServiceSchema.partial();

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
