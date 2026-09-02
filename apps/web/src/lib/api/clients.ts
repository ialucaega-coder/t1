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

export function exportCsv() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  return fetch(`${API_URL}/clients/export/csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async (res) => {
    if (!res.ok) throw new Error('Error al exportar');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clientes.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}
