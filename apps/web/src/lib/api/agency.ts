import { httpClient } from './http-client';
import type { AgencyClient } from '@/constants/agency';
import type { CreateAgencyClientInput, UpdateAgencyClientInput } from '@/types/agency';

export function getStats() {
  return httpClient.get<typeof import('@/constants/agency').AGENCY_STATS>('/agency/stats');
}

/** Tamaño de página de la lista de clientes de agencia (máximo que acepta el server). */
export const AGENCY_PAGE_SIZE = 100;

export interface AgencyClientsPage {
  data: AgencyClient[];
  total: number;
}

/**
 * Una página de clientes de agencia. El server pagina (20 por defecto) y busca por
 * nombre (`search`); antes se pedía solo la primera página sin parámetros y el resto
 * de los clientes nunca aparecía.
 */
export async function getClients(params?: { page?: number; pageSize?: number; search?: string }): Promise<AgencyClientsPage> {
  const qs = new URLSearchParams();
  qs.set('page', String(params?.page ?? 1));
  qs.set('pageSize', String(params?.pageSize ?? AGENCY_PAGE_SIZE));
  if (params?.search) qs.set('search', params.search);
  const res = await httpClient.get<{ data: AgencyClient[]; total: number } | AgencyClient[]>(`/agency/clients?${qs.toString()}`);
  if (Array.isArray(res)) return { data: res, total: res.length };
  return { data: res.data, total: res.total ?? res.data.length };
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
