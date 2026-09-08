'use client';

import { useCallback, useEffect, useState } from 'react';
import { statsApi } from '@/lib/api/index';
import type { StatsOverview, TopService, WeeklyData } from '@/types';

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
