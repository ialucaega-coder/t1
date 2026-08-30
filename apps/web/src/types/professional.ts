import type { Schedule } from './schedule';

export interface Professional {
  id: string;
  bio?: string;
  specialties: string[];
  isAvailable: boolean;
  user: { id: string; name: string; email: string; phone?: string };
  schedules: Schedule[];
  _count: { bookings: number };
}
