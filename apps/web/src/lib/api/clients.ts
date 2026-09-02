import { httpClient } from './http-client';
import type { Client, ClientDetail } from '@/types';

export function getClients(params?: { search?: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  return httpClient.get<{ data: Client[]; total: number; page: number; pageSize: number; totalPages: number }>(
    `/clients${query ? `?${query}` : ''}`
  );
}

export function getClient(id: string) {
  return httpClient.get<ClientDetail>(`/clients/${id}`);
}

export function createClient(data: { name: string; email: string; phone?: string }) {
  return httpClient.post<Client>('/clients', data);
}

export function updateClient(id: string, data: { name?: string; phone?: string }) {
  return httpClient.patch<Client>(`/clients/${id}`, data);
}

export function deleteClient(id: string) {
  return httpClient.delete<{ success: boolean }>(`/clients/${id}`);
}
