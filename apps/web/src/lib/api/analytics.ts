import { httpClient } from './http-client';

export function getKpi() {
  return httpClient.get<any>('/analytics/kpi');
}

export function getConversations() {
  return httpClient.get<any[]>('/analytics/conversations');
}

export function getSatisfaction() {
  return httpClient.get<any[]>('/analytics/satisfaction');
}

export function getImprovements() {
  return httpClient.get<any[]>('/analytics/improvements');
}

export function getCosts() {
  return httpClient.get<any[]>('/analytics/costs');
}

export function getMetrics() {
  return httpClient.get<{ label: string; value: string }[]>('/analytics/metrics');
}
