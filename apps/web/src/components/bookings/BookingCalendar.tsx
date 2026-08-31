import {
  DAYS_OF_WEEK as daysOfWeek,
  TIME_SLOTS as timeSlots,
  BOOKING_STATUS_COLORS as statusColors,
  type Booking,
} from '@/constants/bookings';

interface BookingCalendarProps {
  bookings?: Booking[];
  onSlotClick?: (time: string) => void;
}

export function BookingCalendar({ bookings = [], onSlotClick }: BookingCalendarProps) {
  const bookingsByTime = new Map<string, Booking[]>();
  bookings.forEach((b) => {
    const hourKey = b.time.slice(0, 2) + ':00';
    const list = bookingsByTime.get(hourKey) ?? [];
    list.push(b);
    bookingsByTime.set(hourKey, list);
  });

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[60px_1fr] divide-x divide-slate-800">
        <div />
        <div className="grid grid-cols-7 divide-x divide-slate-800">
          {daysOfWeek.map((day) => (
            <div key={day} className="px-2 py-3 text-center">
              <p className="text-xs font-medium text-slate-400">{day}</p>
            </div>
          ))}
        </div>
      </div>
      {timeSlots.map((time) => {
        const slotBookings = bookingsByTime.get(time) ?? [];
        return (
          <div key={time} className="grid grid-cols-[60px_1fr] divide-x divide-slate-800 border-t border-slate-800">
            <div className="px-2 py-3 text-right">
              <span className="text-[10px] font-mono text-slate-500">{time}</span>
            </div>
            <div className="grid grid-cols-7 divide-x divide-slate-800">
              {daysOfWeek.map((day, dayIdx) => (
                <div
                  key={`${time}-${day}`}
                  className="min-h-[48px] hover:bg-surface-100 transition-colors cursor-pointer p-0.5"
                  onClick={() => onSlotClick?.(time)}
                >
                  {dayIdx === 0 && slotBookings.map((b) => (
                    <div
                      key={b.id}
                      className={`rounded px-1 py-0.5 text-[9px] leading-tight mb-0.5 border ${statusColors[b.status]}`}
                    >
                      <span className="font-medium">{b.client.split(' ')[0]}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
