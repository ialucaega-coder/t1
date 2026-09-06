import { httpClient } from './http-client';

export interface Webhook {
  id: string;
  name: string;
  isActive: boolean;
  url: string;
  events: string[];
  secret: string | null;
}

export function getWebhooks() {
  return httpClient.get<Webhook[]>('/webhooks');
}

export function getEvents() {
  return httpClient.get<string[]>('/webhooks/events');
}

export function createWebhook(data: { name: string; url: string; events: string[]; secret?: string }) {
  return httpClient.post<Webhook>('/webhooks', data);
}

export function updateWebhook(id: string, data: Partial<{ name: string; url: string; events: string[]; secret: string; isActive: boolean }>) {
  return httpClient.patch<Webhook>(`/webhooks/${id}`, data);
}

export function deleteWebhook(id: string) {
  return httpClient.delete<void>(`/webhooks/${id}`);
}

export function testWebhook(id: string) {
  return httpClient.post<{ success: boolean; status: number; error?: string }>(`/webhooks/${id}/test`, {});
}
