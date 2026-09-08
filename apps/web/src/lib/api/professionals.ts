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

export function createProfessional(data: { name: string; email: string; phone?: string; bio?: string; specialties?: string[]; serviceIds?: string[] }) {
  return httpClient.post<Professional>('/professionals', data);
}

export function updateProfessional(id: string, data: { bio?: string; specialties?: string[]; isAvailable?: boolean; serviceIds?: string[] }) {
  return httpClient.put<Professional>(`/professionals/${id}`, data);
}

export function deleteProfessional(id: string) {
  return httpClient.delete<void>(`/professionals/${id}`);
}
