import { httpClient } from './http-client';
import type { Client, ClientDetail, ClientTag } from '@/types';

export function getClients(params?: { search?: string; tagId?: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.tagId) qs.set('tagId', params.tagId);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  return httpClient.get<{
    data: Client[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    tagCatalog: ClientTag[];
  }>(`/clients${query ? `?${query}` : ''}`);
}

/** Anotación del CRM de un cliente (etiquetas asignadas + nota interna). */
export interface ClientAnnotation {
  tags: string[];
  note: string;
}

/** Estado completo del CRM del negocio. */
export interface ClientCrm {
  tags: ClientTag[];
  byClient: Record<string, ClientAnnotation>;
}

export function getClientCrm() {
  return httpClient.get<ClientCrm>('/clients/crm');
}

export function saveClientTags(tags: Array<{ id?: string; label: string; color?: string }>) {
  return httpClient.put<ClientCrm>('/clients/crm/tags', { tags });
}

export function setClientTags(id: string, tags: string[]) {
  return httpClient.put<ClientAnnotation>(`/clients/${id}/tags`, { tags });
}

export function setClientNote(id: string, note: string) {
  return httpClient.put<ClientAnnotation>(`/clients/${id}/note`, { note });
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
