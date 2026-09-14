import { httpClient } from './http-client';
import type {
  AnalyticsKpi,
  AnalyticsConversation,
  AnalyticsSatisfaction,
  AnalyticsImprovement,
  AnalyticsCost,
} from '@/types/analytics';

export function getKpi() {
  return httpClient.get<AnalyticsKpi>('/analytics/kpi');
}

export function getConversations() {
  return httpClient.get<AnalyticsConversation[]>('/analytics/conversations');
}

export function getSatisfaction() {
  return httpClient.get<AnalyticsSatisfaction[]>('/analytics/satisfaction');
}

export function getImprovements() {
  return httpClient.get<AnalyticsImprovement[]>('/analytics/improvements');
}

export function getCosts() {
  return httpClient.get<AnalyticsCost[]>('/analytics/costs');
}

export function getMetrics() {
  return httpClient.get<{ label: string; value: string }[]>('/analytics/metrics');
}
