'use client';

import { useCallback, useEffect, useState } from 'react';
import { bookingsApi } from '@/lib/api/index';
import type { Booking, CreateBookingData } from '@/types';

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
