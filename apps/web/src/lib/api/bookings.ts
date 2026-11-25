import { httpClient } from './http-client';
import type { Booking, CreateBookingData } from '@/types';

export function getBookings(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return httpClient.get<Booking[]>(`/bookings${qs}`);
}

export function createBooking(data: CreateBookingData) {
  return httpClient.post<Booking>('/bookings', data);
}

/** Campos editables de una reserva (PATCH /bookings/:id). `notes: ''` borra las notas. */
export interface UpdateBookingData {
  date?: string;
  startTime?: string;
  serviceId?: string;
  professionalId?: string;
  notes?: string;
}

/** Edita / reprograma una reserva: el server valida pertenencia y conflictos de agenda. */
export function updateBooking(id: string, data: UpdateBookingData) {
  return httpClient.patch<Booking>(`/bookings/${id}`, data);
}

export function updateBookingStatus(id: string, status: string) {
  return httpClient.patch<Booking>(`/bookings/${id}/status`, { status });
}

export function deleteBooking(id: string) {
  return httpClient.delete(`/bookings/${id}`);
}

export function exportCsv() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  return fetch(`${API_URL}/bookings/export/csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async (res) => {
    if (!res.ok) throw new Error('Error al exportar');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reservas.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}
