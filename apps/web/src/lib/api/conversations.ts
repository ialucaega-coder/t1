import { httpClient } from './http-client';

export interface ConversationNote {
  text: string;
  at: string;
  by: string;
  byName?: string;
}

// Datos extra guardados dentro de Conversation.metadata (campo Json del schema).
export interface ConversationMeta {
  assignedTo?: string | null;
  assignedToName?: string | null;
  tags?: string[];
  notes?: ConversationNote[];
  lastReadAt?: string | null;
}

export interface Conversation {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'HANDOFF';
  channel: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  metadata?: ConversationMeta | null;
  createdAt: string;
  updatedAt: string;
  bot?: { name: string; channel: string };
  _count?: { messages: number };
  messages?: { text: string; role: string; createdAt: string }[];
}

export interface ConversationDetail extends Conversation {
  messages: { id: string; role: string; text: string; responseTime: number | null; createdAt: string }[];
}

export function list(params?: { page?: number; pageSize?: number; status?: string; channel?: string }) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params?.status) qs.set('status', params.status);
  if (params?.channel) qs.set('channel', params.channel);
  const query = qs.toString();
  return httpClient.get<{ data: Conversation[]; total: number; page: number; pageSize: number }>(
    `/conversations${query ? `?${query}` : ''}`
  );
}

export function getById(id: string) {
  return httpClient.get<ConversationDetail>(`/conversations/${id}`);
}

export function close(id: string) {
  return httpClient.patch<{ success: boolean }>(`/conversations/${id}/close`, {});
}

export function reply(id: string, text: string) {
  return httpClient.post<{ id: string; role: string; text: string; createdAt: string }>(`/conversations/${id}/reply`, { text });
}

// Asigna la conversación a un miembro del equipo (o desasigna con null).
export function assign(id: string, assignedTo: string | null) {
  return httpClient.patch<{ metadata: ConversationMeta }>(`/conversations/${id}/assign`, { assignedTo });
}

// Reemplaza el conjunto de etiquetas de la conversación.
export function setTags(id: string, tags: string[]) {
  return httpClient.patch<{ metadata: ConversationMeta }>(`/conversations/${id}/tags`, { tags });
}

// Agrega una nota interna a la conversación.
export function addNote(id: string, text: string) {
  return httpClient.post<{ note: ConversationNote; metadata: ConversationMeta }>(`/conversations/${id}/notes`, { text });
}

// Marca la conversación como leída.
export function markRead(id: string) {
  return httpClient.patch<{ metadata: ConversationMeta }>(`/conversations/${id}/read`, {});
}
