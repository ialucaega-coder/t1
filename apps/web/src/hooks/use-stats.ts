'use client';

import { useCallback, useEffect, useState } from 'react';
import { statsApi } from '@/lib/api/index';
import type { StatsOverview, TopService, WeeklyData } from '@/types';
import { WEEKLY_DATA } from '@/constants/stats';

// Fallback de overview cuando la API no responde.
const MOCK_OVERVIEW: StatsOverview = {
  todayBookings: 4,
  monthBookings: 342,
  bookingChange: '+8%',
  totalClients: 128,
  revenue: 45200,
  revenueChange: '+23%',
  activeServices: 7,
  totalProducts: 5,
  noShowRate: '3.2%',
  noShowChange: '-15%',
};

// Adapta los datos semanales mock (day/reservas/ventas) al shape real de la
// API (date/day/bookings/revenue).
function adaptMockWeeklyData(): WeeklyData[] {
  return WEEKLY_DATA.map((w, i) => ({
    date: new Date(Date.now() - (WEEKLY_DATA.length - i) * 86400000).toISOString().slice(0, 10),
    day: w.day,
    bookings: w.reservas,
    revenue: w.ventas,
  }));
}

const MOCK_TOP_SERVICES: TopService[] = [
  { id: '1', name: 'Corte + Peinado', bookingCount: 48 },
  { id: '2', name: 'Color completo', bookingCount: 32 },
  { id: '3', name: 'Barba', bookingCount: 27 },
];

export interface UseStatsResult {
  overview: StatsOverview | null;
  weeklyData: WeeklyData[];
  topServices: TopService[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStats(): UseStatsResult {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
  const [topServices, setTopServices] = useState<TopService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [ov, weekly, top] = await Promise.all([
          statsApi.getOverview(),
          statsApi.getWeeklyStats(),
          statsApi.getTopServices(),
        ]);
        if (!cancelled) {
          setOverview(ov);
          setWeeklyData(weekly);
          setTopServices(top);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar estadísticas');
          setOverview(MOCK_OVERVIEW);
          setWeeklyData(adaptMockWeeklyData());
          setTopServices(MOCK_TOP_SERVICES);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { overview, weeklyData, topServices, isLoading, error, refetch };
}
