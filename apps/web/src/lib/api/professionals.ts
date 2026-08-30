import { httpClient } from './http-client';
import type { Professional } from '@/types';

export function getProfessionals() {
  return httpClient.get<Professional[]>('/professionals');
}

export function getProfessional(id: string) {
  return httpClient.get<Professional>(`/professionals/${id}`);
}

export function getAvailability(professionalId: string, date: string) {
  return httpClient.get<{ available: boolean; slots: string[] }>(
    `/professionals/${professionalId}/availability?date=${date}`
  );
}
