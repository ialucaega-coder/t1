export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface Booking {
  id: string;
  client: string;
  service: string;
  professional: string;
  time: string;
  duration: number;
  status: BookingStatus;
}

export const DAYS_OF_WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const TIME_SLOTS = Array.from(
  { length: 12 },
  (_, i) => `${(i + 8).toString().padStart(2, '0')}:00`
);

export const MOCK_BOOKINGS: Booking[] = [
  { id: '1', client: 'María García', service: 'Corte + Peinado', professional: 'Ana López', time: '09:00', duration: 60, status: 'CONFIRMED' },
  { id: '2', client: 'Juan Pérez', service: 'Barba', professional: 'Carlos Ruiz', time: '10:00', duration: 30, status: 'PENDING' },
  { id: '3', client: 'Laura Méndez', service: 'Color completo', professional: 'Ana López', time: '11:00', duration: 120, status: 'CONFIRMED' },
  { id: '4', client: 'Roberto Silva', service: 'Corte caballero', professional: 'Carlos Ruiz', time: '14:00', duration: 45, status: 'IN_PROGRESS' },
];

export const BOOKING_STATUS_COLORS: Record<BookingStatus, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  CONFIRMED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  COMPLETED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  CANCELLED: 'bg-red-500/10 text-red-400 border-red-500/20',
  NO_SHOW: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No-show',
};

// Backward-compatible aliases matching original page-local names
export const mockBookings = MOCK_BOOKINGS;
export const daysOfWeek = DAYS_OF_WEEK;
export const timeSlots = TIME_SLOTS;
export const statusColors = BOOKING_STATUS_COLORS;
export const statusLabels = BOOKING_STATUS_LABELS;
