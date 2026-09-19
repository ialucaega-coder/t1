'use client';

import { useCallback, useEffect, useState } from 'react';
import { bookingsApi } from '@/lib/api/index';
import type { Booking, CreateBookingData } from '@/types';
import { MOCK_BOOKINGS, type Booking as MockBooking } from '@/constants/bookings';

/**
 * `MOCK_BOOKINGS` usa una forma simplificada (pensada para la UI de calendario),
 * distinta de la interfaz `Booking` de `@/types` (usada por la API real, con
 * client/service/professional como objetos anidados). Este adaptador convierte
 * los datos mock a la forma que espera el hook para poder usarlos como fallback.
 */
function adaptMockBooking(mock: MockBooking, date?: string): Booking {
  const bookingDate = date ?? new Date().toISOString().slice(0, 10);
  const [hours, minutes] = mock.time.split(':').map(Number);
  const endMinutesTotal = hours * 60 + minutes + mock.duration;
  const endTime = `${String(Math.floor(endMinutesTotal / 60) % 24).padStart(2, '0')}:${String(
    endMinutesTotal % 60
  ).padStart(2, '0')}`;

  return {
    id: mock.id,
    date: bookingDate,
    startTime: mock.time,
    endTime,
    status: mock.status,
    source: 'MOCK',
    totalPrice: 0,
    client: { id: `mock-client-${mock.id}`, name: mock.client },
    professional: { id: `mock-professional-${mock.id}`, user: { name: mock.professional } },
    service: { id: `mock-service-${mock.id}`, name: mock.service, duration: mock.duration, price: 0 },
  };
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
        const res = await bookingsApi.getBookings(params);
        const list = Array.isArray(res) ? res : (res as { data: Booking[] }).data;
        if (!cancelled) setBookings(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar reservas');
          setBookings(MOCK_BOOKINGS.map((mock) => adaptMockBooking(mock, date)));
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
