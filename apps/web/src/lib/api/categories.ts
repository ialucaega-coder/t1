import { httpClient } from './http-client';
import type { Category } from '@/types';

export function getCategories() {
  return httpClient.get<Category[]>('/categories');
}

export function createCategory(data: { name: string; icon?: string }) {
  return httpClient.post<Category>('/categories', data);
}

export function updateCategory(id: string, data: Partial<Category>) {
  return httpClient.put<Category>(`/categories/${id}`, data);
}

export function deleteCategory(id: string) {
  return httpClient.delete(`/categories/${id}`);
}
