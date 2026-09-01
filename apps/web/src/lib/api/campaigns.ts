import { httpClient } from './http-client';

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  channel: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function list() {
  return httpClient.get<Campaign[]>('/campaigns');
}

export function create(data: Pick<Campaign, 'name' | 'description' | 'channel'> & { scheduledAt?: string }) {
  return httpClient.post<Campaign>('/campaigns', data);
}

export function update(id: string, data: Partial<Pick<Campaign, 'name' | 'description' | 'status' | 'channel' | 'scheduledAt'>>) {
  return httpClient.patch<Campaign>(`/campaigns/${id}`, data);
}

export function remove(id: string) {
  return httpClient.delete<void>(`/campaigns/${id}`);
}
