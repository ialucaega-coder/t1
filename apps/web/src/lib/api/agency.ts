import { httpClient } from './http-client';

export function getStats() {
  return httpClient.get<any>('/agency/stats');
}

export async function getClients() {
  const res = await httpClient.get<{ data: any[]; total: number }>('/agency/clients');
  return Array.isArray(res) ? res : res.data;
}

export function createClient(data: any) {
  return httpClient.post<any>('/agency/clients', data);
}

export function updateClient(id: string, data: any) {
  return httpClient.patch<any>(`/agency/clients/${id}`, data);
}

export function deleteClient(id: string) {
  return httpClient.delete<void>(`/agency/clients/${id}`);
}
