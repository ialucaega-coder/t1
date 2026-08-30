import { User } from 'lucide-react';
import {
  type Booking,
  BOOKING_STATUS_COLORS as statusColors,
  BOOKING_STATUS_LABELS as statusLabels,
} from '@/constants/bookings';

export interface BookingCardProps {
  booking: Booking;
}

export function BookingCard({ booking }: BookingCardProps) {
  return (
    <div className="card-accent flex items-center gap-4 cursor-pointer">
      <div className="flex items-center justify-center w-16 text-center">
        <div>
          <p className="text-lg font-bold text-white">{booking.time}</p>
          <p className="text-[10px] text-slate-500 font-mono">{booking.duration} MIN</p>
        </div>
      </div>
      <div className="h-10 w-px bg-slate-700" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <User className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-sm font-medium text-white">{booking.client}</span>
        </div>
        <p className="text-xs text-slate-400">{booking.service} · con {booking.professional}</p>
      </div>
      <span className={`badge border ${statusColors[booking.status]}`}>
        {statusLabels[booking.status]}
      </span>
    </div>
  );
}
