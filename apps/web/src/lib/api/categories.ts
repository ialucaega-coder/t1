import { httpClient } from './http-client';
import type { Category } from '@/types';

export function getCategories() {
  return httpClient.get<Category[]>('/categories');
}

export function createCategory(data: { name: string; icon?: string; sortOrder?: number }) {
  return httpClient.post<Category>('/categories', data);
}

export function updateCategory(id: string, data: Partial<Pick<Category, 'name' | 'icon' | 'sortOrder'>>) {
  return httpClient.put<Category>(`/categories/${id}`, data);
}

/**
 * Elimina una categoría. Si tiene productos/servicios el server responde 409;
 * con `detach: true` los deja sin categoría y borra (decisión explícita del usuario).
 */
export function deleteCategory(id: string, opts?: { detach?: boolean }) {
  return httpClient.delete<null>(`/categories/${id}${opts?.detach ? '?detach=true' : ''}`);
}
