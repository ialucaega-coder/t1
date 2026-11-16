'use client';

import { useCallback, useEffect, useState } from 'react';
import { bookingsApi } from '@/lib/api/index';
import type { UpdateBookingData } from '@/lib/api/bookings';
import type { Booking, CreateBookingData } from '@/types';

export interface UseBookingsResult {
  bookings: Booking[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Rechaza con el error REAL del server (p. ej. horario ocupado) para que la UI lo muestre. */
  createBooking: (data: CreateBookingData) => Promise<Booking>;
  updateStatus: (id: string, status: string) => Promise<void>;
  /** Edita / reprograma. Rechaza con el error real del server (conflicto de horario, no encontrada...). */
  updateBooking: (id: string, data: UpdateBookingData) => Promise<Booking>;
  deleteBooking: (id: string) => Promise<void>;
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
          // Sin datos falsos: ante un error dejamos el calendario vacío y mostramos
          // el error, en vez de simular reservas que no existen.
          setBookings([]);
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

  // Estas acciones NO tragan el error: lo propagan para que la pantalla muestre el
  // mensaje real del server (antes devolvían null / seteaban el error global y la UI
  // anunciaba éxito aunque hubiera fallado).
  const createBooking = useCallback(async (data: CreateBookingData) => {
    const created = await bookingsApi.createBooking(data);
    setBookings((prev) => [...prev, created]);
    return created;
  }, []);

  const updateStatus = useCallback(async (id: string, status: string) => {
    const updated = await bookingsApi.updateBookingStatus(id, status);
    setBookings((prev) => prev.map((b) => (b.id === id ? updated : b)));
  }, []);

  const updateBooking = useCallback(async (id: string, data: UpdateBookingData) => {
    const updated = await bookingsApi.updateBooking(id, data);
    setBookings((prev) => prev.map((b) => (b.id === id ? updated : b)));
    return updated;
  }, []);

  const deleteBooking = useCallback(async (id: string) => {
    await bookingsApi.deleteBooking(id);
    setBookings((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return { bookings, isLoading, error, refetch, createBooking, updateStatus, updateBooking, deleteBooking };
}
