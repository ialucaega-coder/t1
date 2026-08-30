import { z } from 'zod';

const orderStatusEnum = z.enum(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']);
const paymentMethodEnum = z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']);

/** Creación de un pedido con sus items. */
export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'El pedido debe tener al menos un item'),
  paymentMethod: paymentMethodEnum,
  clientId: z.string().optional(),
  notes: z.string().optional(),
});

/** Actualización del estado de un pedido. */
export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
