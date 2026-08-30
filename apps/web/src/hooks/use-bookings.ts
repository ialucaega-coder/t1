'use client';

import { useCallback, useEffect, useState } from 'react';
import { bookingsApi } from '@/lib/api/index';
import type { Booking, CreateBookingData } from '@/types';
import { MOCK_BOOKINGS } from '@/constants/bookings';

// Suma minutos a una hora "HH:mm" y devuelve el resultado en el mismo formato.
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % (24 * 60)) / 60)
    .toString()
    .padStart(2, '0');
  const mm = (total % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// Adapta los datos mock (formato simplificado usado en la UI legacy) al
// shape de `Booking` esperado por la API real.
function adaptMockBookings(date?: string): Booking[] {
  const today = date ?? new Date().toISOString().slice(0, 10);
  return MOCK_BOOKINGS.map((b) => ({
    id: b.id,
    date: today,
    startTime: b.time,
    endTime: addMinutes(b.time, b.duration),
    status: b.status,
    source: 'MANUAL',
    totalPrice: 0,
    client: { id: `mock-client-${b.id}`, name: b.client },
    professional: { id: `mock-pro-${b.id}`, user: { name: b.professional } },
    service: { id: `mock-service-${b.id}`, name: b.service, duration: b.duration, price: 0 },
  }));
}

export interface UseBookingsResult {
  bookings: Booking[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createBooking: (data: CreateBookingData) => Promise<Booking | null>;
  updateStatus: (id: string, status: string) => Promise<void>;
}

export function useBookings(date?: string): UseBookingsResult {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const params = date ? { date } : undefined;
        const data = await bookingsApi.getBookings(params);
        if (!cancelled) setBookings(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar reservas');
          // Fallback a datos mock cuando la API no está disponible.
          setBookings(adaptMockBookings(date));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [date, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const createBooking = useCallback(async (data: CreateBookingData) => {
    try {
      const created = await bookingsApi.createBooking(data);
      setBookings((prev) => [...prev, created]);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la reserva');
      return null;
    }
  }, []);

  const updateStatus = useCallback(async (id: string, status: string) => {
    try {
      const updated = await bookingsApi.updateBookingStatus(id, status);
      setBookings((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar el estado');
    }
  }, []);

  return { bookings, isLoading, error, refetch, createBooking, updateStatus };
}
