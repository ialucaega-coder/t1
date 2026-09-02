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

export interface DashboardStats {
  conversations: {
    open: number;
    total: number;
    handoff: number;
    todayMessages: number;
    monthMessages: number;
  };
  bots: {
    active: number;
    total: number;
  };
  subscription: {
    planName: string;
    planTier: string;
    status: string;
    currentPeriodEnd: string;
    maxBots: number;
    maxMessages: number;
    maxContacts: number;
  } | null;
  recentActivity: {
    id: string;
    type: string;
    title: string;
    body: string;
    isRead: boolean;
    createdAt: string;
  }[];
}
