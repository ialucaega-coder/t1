import { httpClient } from './http-client';
import type { Product } from '@/types';

export function getProducts() {
  return httpClient.get<Product[]>('/products');
}

export function createProduct(data: Partial<Product>) {
  return httpClient.post<Product>('/products', data);
}

export function updateProduct(id: string, data: Partial<Product>) {
  return httpClient.put<Product>(`/products/${id}`, data);
}
