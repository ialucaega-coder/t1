import { Calendar, Plus } from 'lucide-react';
import { type Booking } from '@/constants/bookings';
import { BookingCard } from './BookingCard';

export interface BookingListProps {
  bookings: Booking[];
  onSelect?: (booking: Booking) => void;
}

export function BookingList({ bookings, onSelect }: BookingListProps) {
  if (bookings.length === 0) {
    return (
      <div className="text-center py-16">
        <Calendar className="h-12 w-12 text-slate-700 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-400 mb-2">Sin reservas para hoy</h3>
        <p className="text-sm text-slate-500 mb-4">Las reservas de tus clientes aparecerán aquí</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {bookings.map((booking) => (
        <div key={booking.id} onClick={() => onSelect?.(booking)}>
          <BookingCard booking={booking} />
        </div>
      ))}
    </div>
  );
}
