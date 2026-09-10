import { httpClient } from './http-client';
import type { AgencyClient } from '@/constants/agency';
import type { CreateAgencyClientInput, UpdateAgencyClientInput } from '@/types/agency';

export function getStats() {
  return httpClient.get<typeof import('@/constants/agency').AGENCY_STATS>('/agency/stats');
}

export async function getClients() {
  const res = await httpClient.get<{ data: AgencyClient[]; total: number }>('/agency/clients');
  return Array.isArray(res) ? res : res.data;
}

export function createClient(data: CreateAgencyClientInput) {
  return httpClient.post<AgencyClient>('/agency/clients', data);
}

export function updateClient(id: string, data: UpdateAgencyClientInput) {
  return httpClient.patch<AgencyClient>(`/agency/clients/${id}`, data);
}

export function deleteClient(id: string) {
  return httpClient.delete<void>(`/agency/clients/${id}`);
}
