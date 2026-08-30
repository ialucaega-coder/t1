'use client';

import { Terminal, Sparkles, Calendar, ShoppingBag, Users, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useStats } from '@/hooks/use-stats';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

export default function DashboardPage() {
  const { overview, isLoading, error, refetch } = useStats();

  const quickStats = [
    { label: 'Reservas hoy', value: overview ? String(overview.todayBookings) : '0', icon: Calendar, href: '/reservas' },
    { label: 'Servicios activos', value: overview ? String(overview.activeServices) : '0', icon: Sparkles, href: '/servicios' },
    { label: 'Productos', value: overview ? String(overview.totalProducts) : '0', icon: ShoppingBag, href: '/productos' },
    { label: 'Clientes', value: overview ? String(overview.totalClients) : '0', icon: Users, href: '/clientes' },
  ];

  return (
    <div className="space-y-8">
      <div className="card-accent">
        <p className="mono-label mb-2">SIN BOTS TODAVÍA</p>
        <h3 className="text-lg font-bold text-white mb-3">
          Conecta tu primer bot en 2 pasos.
        </h3>
        <div className="rounded-lg bg-surface p-4 font-mono text-sm space-y-3 mb-4">
          <div>
            <span className="text-brand-500">{'>'}</span>{' '}
            <span className="font-semibold text-white">npx localb init</span>
            <p className="text-slate-500 ml-4"># tu agente construye y publica el bot</p>
          </div>
          <div>
            <span className="text-brand-500">{'>'}</span>{' '}
            <span className="font-semibold text-white">localb login</span>
            <p className="text-slate-500 ml-4"># entra con esta misma cuenta — el pairing es automático</p>
          </div>
        </div>
        <p className="text-sm text-slate-400 mb-3">
          Al desplegar con el CLI ya logueado, el bot se registra solo bajo tu cuenta y aparece aquí con sus métricas.
        </p>
        <a href="#" className="mono-label hover:text-brand-300 transition-colors">
          📖 VER LA GUÍA COMPLETA
        </a>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando estadísticas..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Link key={stat.label} href={stat.href} className="card group">
                <div className="flex items-center justify-between mb-3">
                  <Icon className="h-5 w-5 text-brand-400" />
                  <span className="text-2xl font-bold text-white">{stat.value}</span>
                </div>
                <p className="text-sm text-slate-400 group-hover:text-slate-300">{stat.label}</p>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card-accent">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-brand-400 mt-0.5" />
          <div>
            <p className="mono-label mb-1">PLAN COMPLETO</p>
            <h3 className="text-lg font-bold text-white mb-2">
              Todas las funciones <span className="text-brand-400">desbloqueadas.</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">
                  12 superpoderes activos: Blindaje, Vigilante, Cazador de ventas, Cobros, Reportes y más
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">
                  15 plantillas por giro de negocio listas para usar
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">
                  Kit de Agencia, cursos y comunidad incluidos
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">
                  Multi-canal: WhatsApp, Telegram, Web y voz
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
