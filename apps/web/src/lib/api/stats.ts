import { httpClient } from './http-client';
import type { StatsOverview, WeeklyData, TopService, DashboardStats } from '@/types';

export function getOverview() {
  return httpClient.get<StatsOverview>('/stats/overview');
}

export function getWeeklyStats() {
  return httpClient.get<WeeklyData[]>('/stats/weekly');
}

export function getTopServices() {
  return httpClient.get<TopService[]>('/stats/top-services');
}

export function getDashboard() {
  return httpClient.get<DashboardStats>('/stats/dashboard');
}
