import { httpClient } from './http-client';

export function getItems() {
  return httpClient.get<any[]>('/marketplace/items');
}

export function installItem(id: string) {
  return httpClient.post<any>(`/marketplace/items/${id}/install`, {});
}

export function uninstallItem(id: string) {
  return httpClient.delete<void>(`/marketplace/items/${id}/install`);
}
