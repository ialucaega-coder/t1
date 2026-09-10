import { httpClient } from './http-client';
import type { WhitelabelConfig } from '@/types/whitelabel';

export function getSettings() {
  return httpClient.get<WhitelabelConfig>('/whitelabel');
}

export function updateSettings(data: Partial<WhitelabelConfig>) {
  return httpClient.patch<WhitelabelConfig>('/whitelabel', data);
}

export function getPreview() {
  return httpClient.get<WhitelabelConfig>('/whitelabel/preview');
}
