import { httpClient } from './http-client';

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  channel: string;
  status: string;
  sentCount: number;
  openRate: number;
  clickRate: number;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Recipient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export async function list() {
  const res = await httpClient.get<{ data: Campaign[]; total: number }>('/campaigns');
  return Array.isArray(res) ? res : res.data;
}

export function getRecipients(channel?: string) {
  const params = channel ? `?channel=${channel}` : '';
  return httpClient.get<{ total: number; recipients: Recipient[] }>(`/campaigns/recipients${params}`);
}

export function create(data: Pick<Campaign, 'name' | 'description' | 'channel'> & { scheduledAt?: string }) {
  return httpClient.post<Campaign>('/campaigns', data);
}

export function update(id: string, data: Partial<Pick<Campaign, 'name' | 'description' | 'status' | 'channel' | 'scheduledAt'>>) {
  return httpClient.patch<Campaign>(`/campaigns/${id}`, data);
}

export function send(id: string) {
  return httpClient.post<Campaign>(`/campaigns/${id}/send`, {});
}

export function remove(id: string) {
  return httpClient.delete<void>(`/campaigns/${id}`);
}
