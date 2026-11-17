import { httpClient } from './http-client';
import type { Product } from '@/types';

export function getProducts() {
  return httpClient.get<Product[]>('/products');
}

export function createProduct(data: Partial<Product>) {
  return httpClient.post<Product>('/products', data);
}

/** Edición de producto: admite `expectedUpdatedAt` (control de concurrencia, ver el server). */
export type ProductUpdate = Partial<Product> & { expectedUpdatedAt?: string };

/** Mismo texto que el 409 del server (routes/products.ts). */
export const PRODUCT_STALE_MESSAGE = 'El producto cambió mientras lo editabas: recargá';

/** true si el error es el 409 "el producto cambió mientras lo editabas". */
export function isStaleProductError(err: unknown): boolean {
  return err instanceof Error && err.message === PRODUCT_STALE_MESSAGE;
}

export function updateProduct(id: string, data: ProductUpdate) {
  return httpClient.put<Product>(`/products/${id}`, data);
}

export function deleteProduct(id: string) {
  return httpClient.delete<{ success: boolean }>(`/products/${id}`);
}
