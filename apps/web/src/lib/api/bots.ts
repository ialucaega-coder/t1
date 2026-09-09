import { httpClient } from './http-client';

export interface Bot {
  id: string;
  name: string;
  description: string | null;
  channel: 'TELEGRAM' | 'WHATSAPP' | 'WEBCHAT' | 'INSTAGRAM';
  status: 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ERROR';
  token: string | null;
  webhookUrl: string | null;
  config: any;
  lastActiveAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  _count?: { conversations: number };
}

export async function list() {
  const res = await httpClient.get<{ data: Bot[]; total: number }>('/bots');
  return Array.isArray(res) ? res : res.data;
}

export function getById(id: string) {
  return httpClient.get<Bot>(`/bots/${id}`);
}

export function create(data: Pick<Bot, 'name' | 'description' | 'channel'> & { config?: any }) {
  return httpClient.post<Bot>('/bots', data);
}

export function update(id: string, data: Partial<Pick<Bot, 'name' | 'description' | 'channel' | 'status' | 'config' | 'token' | 'webhookUrl'>>) {
  return httpClient.patch<Bot>(`/bots/${id}`, data);
}

export function remove(id: string) {
  return httpClient.delete<void>(`/bots/${id}`);
}
