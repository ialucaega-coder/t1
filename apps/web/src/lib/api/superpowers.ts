import { httpClient } from './http-client';

export interface SuperpowerData {
  name: string;
  subtitle: string;
  description: string;
  iconName: string;
  isActive: boolean;
}

export function getSuperpowers() {
  return httpClient.get<SuperpowerData[]>('/superpowers');
}

export function updateSuperpower(name: string, data: Partial<SuperpowerData>) {
  return httpClient.put<SuperpowerData>(`/superpowers/${encodeURIComponent(name)}`, data);
}
