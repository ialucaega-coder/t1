import { httpClient } from './http-client';
import type { MarketplaceItem, MarketplaceInstallResponse } from '@/types/marketplace';

export function getItems() {
  return httpClient.get<MarketplaceItem[]>('/marketplace/items');
}

export function installItem(id: string) {
  return httpClient.post<MarketplaceInstallResponse>(`/marketplace/items/${id}/install`, {});
}

export function uninstallItem(id: string) {
  return httpClient.delete<void>(`/marketplace/items/${id}/install`);
}
