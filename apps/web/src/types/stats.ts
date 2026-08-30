export interface StatsOverview {
  todayBookings: number;
  monthBookings: number;
  bookingChange: string;
  totalClients: number;
  revenue: number;
  revenueChange: string;
  activeServices: number;
  totalProducts: number;
  noShowRate: string;
  noShowChange: string;
}

export interface WeeklyData {
  date: string;
  day: string;
  bookings: number;
  revenue: number;
}

export interface TopService {
  id: string;
  name: string;
  bookingCount: number;
}
