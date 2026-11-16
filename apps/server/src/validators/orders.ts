import { z } from 'zod';

const orderStatusEnum = z.enum(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']);

export type OrderStatusValue = z.infer<typeof orderStatusEnum>;

/**
 * Flujo normal de un pedido, en orden. DELIVERED y CANCELLED son estados finales.
 *
 * Transiciones permitidas (validadas en el server, PATCH /orders/:id/status):
 *  - Hacia adelante: de cualquier estado del flujo a uno POSTERIOR (se permite
 *    saltear pasos, p. ej. PENDING -> DELIVERED en una venta de mostrador).
 *  - A CANCELLED: desde cualquier estado NO final (PENDING, CONFIRMED, PREPARING, READY).
 *  - Nunca hacia atrás (p. ej. READY -> PREPARING) ni desde un estado final: un
 *    pedido ENTREGADO no se cancela (requeriría devolución de stock y dinero, que
 *    es un movimiento aparte) y uno CANCELADO no se reabre.
 *  - Repetir el estado actual no es una transición (se responde sin cambios).
 */
export const ORDER_FLOW = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED'] as const;

export function canTransitionOrder(from: OrderStatusValue, to: OrderStatusValue): boolean {
  if (from === to) return false;
  if (from === 'DELIVERED' || from === 'CANCELLED') return false;
  if (to === 'CANCELLED') return true;
  return ORDER_FLOW.indexOf(to as (typeof ORDER_FLOW)[number]) > ORDER_FLOW.indexOf(from as (typeof ORDER_FLOW)[number]);
}
const paymentMethodEnum = z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']);

/** Creación de un pedido con sus items. */
export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive().max(10000),
      })
    )
    .min(1, 'El pedido debe tener al menos un item')
    .max(100, 'El pedido no puede tener más de 100 items'),
  paymentMethod: paymentMethodEnum,
  clientId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

/** Actualización del estado de un pedido. */
export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
});

/** Nota interna del pedido (se guarda en Order.notes). Vacía = borrar la nota. */
export const updateOrderNotesSchema = z.object({
  notes: z.string().max(2000, 'La nota no puede superar los 2000 caracteres'),
});

/** Filtros del listado: estado y búsqueda por cliente (nombre/teléfono/email) o código ORD-XXXXXXXX. */
export const listOrdersQuerySchema = z.object({
  status: orderStatusEnum.optional(),
  search: z.string().trim().max(100).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type UpdateOrderNotesInput = z.infer<typeof updateOrderNotesSchema>;
