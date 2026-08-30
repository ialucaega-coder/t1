'use client';

import { Users, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import { useStats } from '@/hooks/use-stats';
import { type StatCard as LegacyStatCard, type WeeklyDataPoint } from '@/constants/stats';
import { StatCard } from '@/components/stats/StatCard';
import { WeeklyChart } from '@/components/stats/WeeklyChart';
import { TopServicesList } from '@/components/stats/TopServicesList';
import { HealthIndicators } from '@/components/stats/HealthIndicators';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

export default function EstadisticasPage() {
  const { overview, weeklyData, topServices, isLoading, error, refetch } = useStats();

  const statCards: LegacyStatCard[] = overview
    ? [
        {
          label: 'Clientes',
          value: overview.totalClients.toLocaleString('es-AR'),
          change: overview.bookingChange,
          trend: overview.bookingChange.startsWith('-') ? 'down' : 'up',
          icon: Users,
        },
        {
          label: 'Reservas',
          value: overview.monthBookings.toLocaleString('es-AR'),
          change: overview.bookingChange,
          trend: overview.bookingChange.startsWith('-') ? 'down' : 'up',
          icon: Calendar,
        },
        {
          label: 'Ingresos',
          value: `$${overview.revenue.toLocaleString('es-AR')}`,
          change: overview.revenueChange,
          trend: overview.revenueChange.startsWith('-') ? 'down' : 'up',
          icon: DollarSign,
        },
        {
          label: 'No-shows',
          value: overview.noShowRate,
          change: overview.noShowChange,
          trend: overview.noShowChange.startsWith('-') ? 'down' : 'up',
          icon: TrendingUp,
        },
      ]
    : [];

  const weeklyChartData: WeeklyDataPoint[] = weeklyData.map((w) => ({
    day: w.day,
    reservas: w.bookings,
    ventas: w.revenue,
  }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        El pulso del mes de TODA tu operación — leads, mensajes, conversaciones y salud de cada bot, sumados y leídos en vivo.
      </p>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando estadísticas..." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((stat) => (
              <StatCard key={stat.label} stat={stat} />
            ))}
          </div>

          <WeeklyChart data={weeklyChartData} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TopServicesList services={topServices} />
            <HealthIndicators />
          </div>
        </>
      )}
    </div>
  );
}
