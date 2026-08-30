import { httpClient } from './http-client';
import type { Booking, CreateBookingData } from '@/types';

export function getBookings(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return httpClient.get<Booking[]>(`/bookings${qs}`);
}

export function createBooking(data: CreateBookingData) {
  return httpClient.post<Booking>('/bookings', data);
}

export function updateBookingStatus(id: string, status: string) {
  return httpClient.patch<Booking>(`/bookings/${id}/status`, { status });
}

export function deleteBooking(id: string) {
  return httpClient.delete(`/bookings/${id}`);
}
