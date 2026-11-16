'use client';

import { useState } from 'react';
import { Users, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import { useStats } from '@/hooks/use-stats';
import { type StatCard as LegacyStatCard, type WeeklyDataPoint } from '@/constants/stats';
import { StatCard } from '@/components/stats/StatCard';
import { WeeklyChart } from '@/components/stats/WeeklyChart';
import { TopServicesList } from '@/components/stats/TopServicesList';
import { HealthIndicators } from '@/components/stats/HealthIndicators';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { DateRangeBar } from '@/components/common/DateRangeBar';
import { DEFAULT_RANGE, rangeKey, rangeLabel, todayLocalKey, type RangeSelection } from '@/lib/date-range';
import { downloadCsv } from '@/lib/csv';
import { buildStatsRows, exportFilename } from '@/lib/export-rows';

export default function EstadisticasPage() {
  const [range, setRange] = useState<RangeSelection>(DEFAULT_RANGE);
  const { overview, weeklyData, topServices, isLoading, error, refetch } = useStats(range);

  // Exporta lo que se ve (datos ya cargados): sin pedidos extra al server.
  const handleExport = () => {
    downloadCsv(
      exportFilename('estadisticas', rangeKey(range), todayLocalKey()),
      buildStatsRows({ range, overview, weeklyData, topServices }),
    );
  };

  // Período que cubren los "más reservados": sin rango elegido es el mes en curso.
  const topServicesPeriod = range.kind === 'default' ? 'este mes' : rangeLabel(range).toLowerCase();

  const statCards: LegacyStatCard[] = overview
    ? [
        {
          label: 'Clientes',
          value: overview.totalClients.toLocaleString('es-AR'),
          // El overview no trae variación de clientes (bookingChange es la de reservas):
          // se deja vacío y la tarjeta se renderiza sin variación, en vez de mostrar un dato ajeno.
          change: '',
          trend: 'up',
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

      <DateRangeBar value={range} onChange={setRange} onExport={handleExport} exportDisabled={isLoading || !overview} />

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando estadísticas..." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((stat) =>
              stat.change ? (
                <StatCard key={stat.label} stat={stat} />
              ) : (
                <div key={stat.label} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <stat.icon className="h-5 w-5 text-brand-400" />
                  </div>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
                </div>
              ),
            )}
          </div>

          <WeeklyChart data={weeklyChartData} days={weeklyData.length || 7} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TopServicesList services={topServices} periodText={topServicesPeriod} />
            <HealthIndicators />
          </div>
        </>
      )}
    </div>
  );
}
