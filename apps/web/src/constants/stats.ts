import { TrendingUp, Users, Calendar, DollarSign, type LucideIcon } from 'lucide-react';

export interface StatCard {
  label: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  icon: LucideIcon;
}

export interface WeeklyDataPoint {
  day: string;
  reservas: number;
  ventas: number;
}

export const STATS_CARDS: StatCard[] = [
  { label: 'Conversaciones', value: '1,284', change: '+12%', trend: 'up', icon: Users },
  { label: 'Reservas', value: '342', change: '+8%', trend: 'up', icon: Calendar },
  { label: 'Ingresos', value: '$45,200', change: '+23%', trend: 'up', icon: DollarSign },
  { label: 'No-shows', value: '3.2%', change: '-15%', trend: 'down', icon: TrendingUp },
];

export const WEEKLY_DATA: WeeklyDataPoint[] = [
  { day: 'Lun', reservas: 12, ventas: 8500 },
  { day: 'Mar', reservas: 15, ventas: 12300 },
  { day: 'Mié', reservas: 18, ventas: 15100 },
  { day: 'Jue', reservas: 14, ventas: 11200 },
  { day: 'Vie', reservas: 22, ventas: 18400 },
  { day: 'Sáb', reservas: 28, ventas: 24600 },
  { day: 'Dom', reservas: 5, ventas: 3200 },
];
