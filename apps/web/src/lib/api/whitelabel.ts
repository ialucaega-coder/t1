import { httpClient } from './http-client';

export function getSettings() {
  return httpClient.get<any>('/whitelabel');
}

export function updateSettings(data: any) {
  return httpClient.patch<any>('/whitelabel', data);
}

export function getPreview() {
  return httpClient.get<any>('/whitelabel/preview');
}
