'use client';

import { useCallback, useEffect, useState } from 'react';
import { analyticsApi } from '@/lib/api/index';
import { DEFAULT_RANGE, rangeParams, type RangeSelection } from '@/lib/date-range';
import type { AnalyticsKpi, AnalyticsTimeseriesPoint, AnalyticsFunnel, AnalyticsAttribution } from '@/types/analytics';
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
  kpi: AnalyticsKpi;
  conversations: typeof DAILY_CONVERSATIONS;
  satisfaction: typeof SATISFACTION_DISTRIBUTION;
  improvements: typeof SUGGESTED_IMPROVEMENTS;
  costs: typeof AI_COSTS;
  metrics: MetricItem[];
  timeseries: AnalyticsTimeseriesPoint[];
  funnel: AnalyticsFunnel | null;
  attribution: AnalyticsAttribution | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// Valores vacíos/en cero: son el estado honesto antes de cargar y ante un error
// de la API. Antes el hook arrancaba (y caía) con datos de ejemplo, que hacían
// ver números inventados como si fueran reales.
const EMPTY_KPI: AnalyticsKpi = {
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

/** @param range rango elegido; sin él el server usa su ventana histórica (30 días). Cambiarlo recarga los datos. */
export function useAnalytics(range: RangeSelection = DEFAULT_RANGE): UseAnalyticsResult {
  const [kpi, setKpi] = useState<AnalyticsKpi>(EMPTY_KPI);
  const [conversations, setConversations] = useState<typeof DAILY_CONVERSATIONS>([]);
  const [satisfaction, setSatisfaction] = useState<typeof SATISFACTION_DISTRIBUTION>([]);
  const [improvements, setImprovements] = useState<typeof SUGGESTED_IMPROVEMENTS>([]);
  const [costs, setCosts] = useState<typeof AI_COSTS>([]);
  const [metrics, setMetrics] = useState<MetricItem[]>([]);
  const [timeseries, setTimeseries] = useState<AnalyticsTimeseriesPoint[]>([]);
  const [funnel, setFunnel] = useState<AnalyticsFunnel | null>(null);
  const [attribution, setAttribution] = useState<AnalyticsAttribution | null>(null);
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
        const [kpiRes, convRes, satRes, impRes, costRes, metricsRes, tsRes, funnelRes, attrRes] = await Promise.all([
          analyticsApi.getKpi(params),
          analyticsApi.getConversations(params),
          analyticsApi.getSatisfaction(params),
          analyticsApi.getImprovements(params),
          analyticsApi.getCosts(params),
          analyticsApi.getMetrics(params),
          analyticsApi.getTimeseries(params),
          analyticsApi.getFunnel(),
          analyticsApi.getAttribution(params),
        ]);
        if (!cancelled) {
          setKpi(kpiRes);
          setConversations(convRes);
          setSatisfaction(satRes);
          setImprovements(impRes);
          setCosts(costRes);
          setMetrics(metricsRes);
          setTimeseries(tsRes);
          setFunnel(funnelRes);
          setAttribution(attrRes);
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
          setTimeseries([]);
          setFunnel(null);
          setAttribution(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken, range]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { kpi, conversations, satisfaction, improvements, costs, metrics, timeseries, funnel, attribution, isLoading, error, refetch };
}
