import {
  DAYS_OF_WEEK as daysOfWeek,
  TIME_SLOTS as timeSlots,
} from '@/constants/bookings';

export function BookingCalendar() {
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
      {timeSlots.map((time) => (
        <div key={time} className="grid grid-cols-[60px_1fr] divide-x divide-slate-800 border-t border-slate-800">
          <div className="px-2 py-3 text-right">
            <span className="text-[10px] font-mono text-slate-500">{time}</span>
          </div>
          <div className="grid grid-cols-7 divide-x divide-slate-800">
            {daysOfWeek.map((day) => (
              <div key={`${time}-${day}`} className="min-h-[48px] hover:bg-surface-100 transition-colors cursor-pointer" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
