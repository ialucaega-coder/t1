import { httpClient } from './http-client';
import type { Order, CreateOrderData, PaginatedResponse } from '@/types';

export function getOrders(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return httpClient.get<PaginatedResponse<Order>>(`/orders${qs}`);
}

/**
 * Alta de un pedido. El precio y el total los calcula SIEMPRE el servidor a partir
 * de los productos del negocio: solo se envían productId + cantidad. Con
 * `idempotencyKey` un reintento/doble click no duplica el pedido ni la venta.
 */
export function createOrder(data: CreateOrderData, idempotencyKey?: string) {
  return httpClient.post<Order>('/orders', data, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
}

export function updateOrderStatus(id: string, status: string) {
  return httpClient.patch<Order>(`/orders/${id}/status`, { status });
}

/** Nota interna del pedido. Una nota vacía la borra. */
export function updateOrderNotes(id: string, notes: string) {
  return httpClient.patch<Order>(`/orders/${id}/notes`, { notes });
}
