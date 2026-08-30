import { httpClient } from './http-client';
import type { QuickItem } from '@/constants/pos';

export function getPosItems() {
  return httpClient.get<QuickItem[]>('/pos/items');
}
