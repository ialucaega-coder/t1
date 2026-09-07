'use client';

import { useCallback, useEffect, useState } from 'react';
import { analyticsApi } from '@/lib/api/index';
import {
  DAILY_CONVERSATIONS,
  SATISFACTION_DISTRIBUTION,
  SUGGESTED_IMPROVEMENTS,
  AI_COSTS,
  KPI_SUMMARY,
} from '@/constants/analytics';

export interface MetricItem {
  label: string;
  value: string;
}

export interface UseAnalyticsResult {
  kpi: typeof KPI_SUMMARY;
  conversations: typeof DAILY_CONVERSATIONS;
  satisfaction: typeof SATISFACTION_DISTRIBUTION;
  improvements: typeof SUGGESTED_IMPROVEMENTS;
  costs: typeof AI_COSTS;
  metrics: MetricItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAnalytics(): UseAnalyticsResult {
  const [kpi, setKpi] = useState(KPI_SUMMARY);
  const [conversations, setConversations] = useState(DAILY_CONVERSATIONS);
  const [satisfaction, setSatisfaction] = useState(SATISFACTION_DISTRIBUTION);
  const [improvements, setImprovements] = useState(SUGGESTED_IMPROVEMENTS);
  const [costs, setCosts] = useState(AI_COSTS);
  const [metrics, setMetrics] = useState<MetricItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [kpiRes, convRes, satRes, impRes, costRes, metricsRes] = await Promise.all([
          analyticsApi.getKpi(),
          analyticsApi.getConversations(),
          analyticsApi.getSatisfaction(),
          analyticsApi.getImprovements(),
          analyticsApi.getCosts(),
          analyticsApi.getMetrics(),
        ]);
        if (!cancelled) {
          setKpi(kpiRes);
          setConversations(convRes);
          setSatisfaction(satRes);
          setImprovements(impRes);
          setCosts(costRes);
          setMetrics(metricsRes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar análisis');
          setKpi(KPI_SUMMARY);
          setConversations(DAILY_CONVERSATIONS);
          setSatisfaction(SATISFACTION_DISTRIBUTION);
          setImprovements(SUGGESTED_IMPROVEMENTS);
          setCosts(AI_COSTS);
          setMetrics([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { kpi, conversations, satisfaction, improvements, costs, metrics, isLoading, error, refetch };
}
