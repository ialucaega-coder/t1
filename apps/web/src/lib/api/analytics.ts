import { httpClient } from './http-client';
import { rangeQuery, type RangeParams } from '../date-range';
import type {
  AnalyticsKpi,
  AnalyticsConversation,
  AnalyticsSatisfaction,
  AnalyticsImprovement,
  AnalyticsCost,
  AnalyticsTimeseriesPoint,
  AnalyticsFunnel,
  AnalyticsAttribution,
} from '@/types/analytics';

// Todos los endpoints de series/KPIs aceptan un rango opcional (?days= o ?from=&to=);
// sin rango el server usa su ventana histórica. El embudo CRM es una foto actual: no lo usa.

export function getKpi(range?: RangeParams) {
  return httpClient.get<AnalyticsKpi>(`/analytics/kpi${rangeQuery(range)}`);
}

export function getConversations(range?: RangeParams) {
  return httpClient.get<AnalyticsConversation[]>(`/analytics/conversations${rangeQuery(range)}`);
}

export function getSatisfaction(range?: RangeParams) {
  return httpClient.get<AnalyticsSatisfaction[]>(`/analytics/satisfaction${rangeQuery(range)}`);
}

export function getImprovements(range?: RangeParams) {
  return httpClient.get<AnalyticsImprovement[]>(`/analytics/improvements${rangeQuery(range)}`);
}

export function getCosts(range?: RangeParams) {
  return httpClient.get<AnalyticsCost[]>(`/analytics/costs${rangeQuery(range)}`);
}

export function getMetrics(range?: RangeParams) {
  return httpClient.get<{ label: string; value: string }[]>(`/analytics/metrics${rangeQuery(range)}`);
}

export function getTimeseries(range?: RangeParams) {
  return httpClient.get<AnalyticsTimeseriesPoint[]>(`/analytics/timeseries${rangeQuery(range)}`);
}

export function getFunnel() {
  return httpClient.get<AnalyticsFunnel>('/analytics/funnel');
}

// Embudo por origen (Click-to-WhatsApp): de qué anuncio vinieron las charlas.
export function getAttribution(range?: RangeParams) {
  return httpClient.get<AnalyticsAttribution>(`/analytics/attribution${rangeQuery(range)}`);
}
