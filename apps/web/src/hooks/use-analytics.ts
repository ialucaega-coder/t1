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

// Valores vacíos/en cero: son el estado honesto antes de cargar y ante un error
// de la API. Antes el hook arrancaba (y caía) con datos de ejemplo, que hacían
// ver números inventados como si fueran reales.
const EMPTY_KPI: typeof KPI_SUMMARY = {
  totalConversations: 0,
  conversationsChange: 0,
  avgSatisfaction: 0,
  satisfactionChange: 0,
  monthlyAiCost: 0,
  aiCostChange: 0,
  conversionRate: 0,
  conversionChange: 0,
  monthlyBudget: KPI_SUMMARY.monthlyBudget,
};

export function useAnalytics(): UseAnalyticsResult {
  const [kpi, setKpi] = useState<typeof KPI_SUMMARY>(EMPTY_KPI);
  const [conversations, setConversations] = useState<typeof DAILY_CONVERSATIONS>([]);
  const [satisfaction, setSatisfaction] = useState<typeof SATISFACTION_DISTRIBUTION>([]);
  const [improvements, setImprovements] = useState<typeof SUGGESTED_IMPROVEMENTS>([]);
  const [costs, setCosts] = useState<typeof AI_COSTS>([]);
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
          // Sin datos falsos: ante un error dejamos todo en cero/vacío y mostramos
          // el ErrorAlert, en vez de simular métricas que no son reales.
          setKpi(EMPTY_KPI);
          setConversations([]);
          setSatisfaction([]);
          setImprovements([]);
          setCosts([]);
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
