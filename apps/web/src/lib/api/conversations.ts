import { httpClient } from './http-client';

export interface Conversation {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'HANDOFF';
  channel: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
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
