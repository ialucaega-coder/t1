'use client';

import { useCallback, useEffect, useState } from 'react';
import { statsApi } from '@/lib/api/index';
import type { StatsOverview, TopService, WeeklyData } from '@/types';
import { DEFAULT_RANGE, rangeParams, type RangeSelection } from '@/lib/date-range';

export interface UseStatsResult {
  overview: StatsOverview | null;
  weeklyData: WeeklyData[];
  topServices: TopService[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** @param range rango elegido; sin él el server usa su ventana histórica (mes / 7 días). Cambiarlo recarga los datos. */
export function useStats(range: RangeSelection = DEFAULT_RANGE): UseStatsResult {
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
        const params = rangeParams(range);
        const [ov, weekly, top] = await Promise.all([
          statsApi.getOverview(params),
          statsApi.getWeeklyStats(params),
          statsApi.getTopServices(params),
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
  }, [reloadToken, range]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { overview, weeklyData, topServices, isLoading, error, refetch };
}
