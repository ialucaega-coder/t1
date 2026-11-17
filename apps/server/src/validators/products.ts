import { z } from 'zod';
import { patchSchema } from './patch';
import { imageUrlSchema, sortOrderSchema } from './image-url';

/** Tope del precio: la columna es Decimal(10,2) = 99.999.999,99. */
export const MAX_PRICE = 99_999_999.99;
/** Tope de stock: evita desbordar el Int y valores absurdos. */
export const MAX_STOCK = 1_000_000;

/** Creación de un producto. */
export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: z
    .number()
    .positive('El precio debe ser mayor a 0')
    .max(MAX_PRICE, 'El precio no puede superar 99.999.999,99'),
  stock: z
    .number()
    .int('El stock debe ser un número entero')
    .min(0, 'El stock no puede ser negativo')
    .max(MAX_STOCK, 'El stock no puede superar 1.000.000')
    .default(0),
  // null = sin categoría (permite quitarla al editar).
  categoryId: z.string().nullable().optional(),
  // null = sin imagen (permite quitarla al editar).
  image: imageUrlSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  isActive: z.boolean().default(true),
});

/** Actualización parcial de un producto. */
export const updateProductSchema = patchSchema(createProductSchema).extend({
  /**
   * Control de concurrencia optimista: `updatedAt` del producto tal como lo vio
   * quien edita. Si cambió (p. ej. una venta descontó stock), el PUT responde 409
   * en vez de pisar el stock con un valor viejo.
   */
  expectedUpdatedAt: z.string().datetime({ message: 'expectedUpdatedAt debe ser una fecha ISO' }).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
