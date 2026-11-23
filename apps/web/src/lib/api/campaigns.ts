import { httpClient } from './http-client';

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  channel: string;
  status: string;
  sentCount: number;
  /** % de destinatarios que abrieron / hicieron clic (solo email; 0 = sin datos todavía). */
  openRate?: number;
  clickRate?: number;
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

/** `scheduledAt` va en ISO UTC (con "Z") y tiene que ser futuro; sin él nace como borrador. */
export function create(data: Pick<Campaign, 'name' | 'description' | 'channel'> & { scheduledAt?: string }) {
  return httpClient.post<Campaign>('/campaigns', data);
}

/** `scheduledAt: null` desprograma (vuelve a borrador). El server rechaza editar una 'sent'/'sending'. */
export function update(id: string, data: Partial<Pick<Campaign, 'name' | 'description' | 'status' | 'channel' | 'scheduledAt'>>) {
  return httpClient.patch<Campaign>(`/campaigns/${id}`, data);
}

export function send(id: string) {
  return httpClient.post<Campaign>(`/campaigns/${id}/send`, {});
}

export function remove(id: string) {
  return httpClient.delete<void>(`/campaigns/${id}`);
}
