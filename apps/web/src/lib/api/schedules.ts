import { httpClient } from './http-client';
import type { Schedule } from '@/types';

export function getSchedules(professionalId?: string) {
  const qs = professionalId ? `?professionalId=${professionalId}` : '';
  return httpClient.get<Schedule[]>(`/schedules${qs}`);
}

export function createSchedule(data: Partial<Schedule>) {
  return httpClient.post<Schedule>('/schedules', data);
}

export function updateSchedule(id: string, data: Partial<Schedule>) {
  return httpClient.put<Schedule>(`/schedules/${id}`, data);
}

export function deleteSchedule(id: string) {
  return httpClient.delete(`/schedules/${id}`);
}
