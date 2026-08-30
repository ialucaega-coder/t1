import { httpClient } from './http-client';
import type { Order, CreateOrderData, PaginatedResponse } from '@/types';

export function getOrders(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return httpClient.get<PaginatedResponse<Order>>(`/orders${qs}`);
}

export function createOrder(data: CreateOrderData) {
  return httpClient.post<Order>('/orders', data);
}

export function updateOrderStatus(id: string, status: string) {
  return httpClient.patch<Order>(`/orders/${id}/status`, { status });
}
