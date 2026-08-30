'use client';

import { useState } from 'react';
import { Plus, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBookings } from '@/hooks/use-bookings';
import type { Booking as ApiBooking } from '@/types';
import { type Booking as LegacyBooking } from '@/constants/bookings';
import { BookingList } from '@/components/bookings/BookingList';
import { BookingCalendar } from '@/components/bookings/BookingCalendar';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

type ViewMode = 'calendar' | 'list';

// Adapta el shape de `Booking` de la API (objetos anidados para cliente,
// profesional y servicio) al shape simplificado que consumen los
// componentes de UI existentes (BookingList / BookingCard).
function toLegacyBooking(booking: ApiBooking): LegacyBooking {
  return {
    id: booking.id,
    client: booking.client?.name ?? '',
    service: booking.service?.name ?? '',
    professional: booking.professional?.user?.name ?? '',
    time: booking.startTime,
    duration: booking.service?.duration ?? 0,
    status: booking.status as LegacyBooking['status'],
  };
}

export default function ReservasPage() {
  const [view, setView] = useState<ViewMode>('list');
  const today = new Date();
  const { bookings, isLoading, error, refetch } = useBookings();

  const legacyBookings = bookings.map(toLegacyBooking);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'list' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Lista
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'calendar' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Calendario
            </button>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <button className="p-1 hover:text-white transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-white">
              {today.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <button className="p-1 hover:text-white transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs">
            <Filter className="h-3.5 w-3.5" /> Filtrar
          </button>
          <button className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Nueva reserva
          </button>
        </div>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando reservas..." />
      ) : view === 'list' ? (
        <BookingList bookings={legacyBookings} />
      ) : (
        <BookingCalendar />
      )}
    </div>
  );
}
