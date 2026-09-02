import { httpClient } from './http-client';
import type { Service } from '@/types';

export function getServices() {
  return httpClient.get<Service[]>('/services');
}

export function createService(data: Partial<Service>) {
  return httpClient.post<Service>('/services', data);
}

export function updateService(id: string, data: Partial<Service>) {
  return httpClient.put<Service>(`/services/${id}`, data);
}

export function deleteService(id: string) {
  return httpClient.delete<{ success: boolean }>(`/services/${id}`);
}
