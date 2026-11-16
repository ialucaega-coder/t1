import { httpClient } from './http-client';
import { rangeQuery, type RangeParams } from '../date-range';
import type { StatsOverview, WeeklyData, TopService, DashboardStats } from '@/types';

// overview, weekly y top-services aceptan un rango opcional (?days= o ?from=&to=);
// sin rango el server usa su ventana histórica (mes / últimos 7 días).
export function getOverview(range?: RangeParams) {
  return httpClient.get<StatsOverview>(`/stats/overview${rangeQuery(range)}`);
}

export function getWeeklyStats(range?: RangeParams) {
  return httpClient.get<WeeklyData[]>(`/stats/weekly${rangeQuery(range)}`);
}

export function getTopServices(range?: RangeParams) {
  return httpClient.get<TopService[]>(`/stats/top-services${rangeQuery(range)}`);
}

export function getDashboard() {
  return httpClient.get<DashboardStats>('/stats/dashboard');
}

export interface HealthIndicator {
  key: string;
  label: string;
  value: string;
  numericValue: number;
  good: boolean;
  change: number;
}

export function getHealthIndicators() {
  return httpClient.get<{ indicators: HealthIndicator[] }>('/stats/health');
}
