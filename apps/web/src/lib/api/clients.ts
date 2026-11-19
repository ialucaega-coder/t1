import { httpClient, API_URL } from './http-client';
import type { Client, ClientDetail, ClientTag, LifecycleStage } from '@/types';

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

/** Conteo del embudo (clientes por etapa del ciclo de vida). */
export interface ClientFunnel {
  counts: Record<LifecycleStage, number>;
  total: number;
  stages: LifecycleStage[];
}

export function getClientFunnel() {
  return httpClient.get<ClientFunnel>('/clients/funnel');
}

export function setClientLifecycle(id: string, stage: LifecycleStage) {
  return httpClient.patch<{ stage: LifecycleStage }>(`/clients/${id}/lifecycle`, { stage });
}

export function getClient(id: string) {
  return httpClient.get<ClientDetail>(`/clients/${id}`);
}

export function createClient(data: { name: string; email: string; phone?: string }) {
  return httpClient.post<Client>('/clients', data);
}

/** `phone: null` (o '') borra el teléfono; omitirlo lo deja como está. */
export function updateClient(id: string, data: { name?: string; phone?: string | null }) {
  return httpClient.patch<Client>(`/clients/${id}`, data);
}

export function deleteClient(id: string) {
  return httpClient.delete<{ success: boolean }>(`/clients/${id}`);
}

/** Espera antes de liberar el objeto URL (revocarlo en el mismo tick puede cortar la descarga). */
const REVOKE_DELAY_MS = 1000;

/**
 * Descarga el CSV de clientes. Usa el token del cliente http y trata los errores
 * igual que él: 401 = sesión vencida (se limpia el token y se va al login), 403 = sin
 * permiso, y el resto muestra el mensaje real del server. Lanza un Error con un texto
 * listo para mostrar al usuario.
 */
export async function exportCsv(): Promise<void> {
  const token = httpClient.getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/clients/export/csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
  }

  if (res.status === 401) {
    httpClient.setToken(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Tu sesión venció. Volvé a iniciar sesión.');
  }
  if (res.status === 403) {
    throw new Error('No tenés permiso para exportar los clientes.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && typeof body.error === 'string' && body.error) || 'Error al exportar los clientes');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'clientes.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
