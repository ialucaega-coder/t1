import { httpClient } from './http-client';
import type { Client } from '@/types';

export function getClients(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return httpClient.get<Client[]>(`/clients${qs}`);
}
