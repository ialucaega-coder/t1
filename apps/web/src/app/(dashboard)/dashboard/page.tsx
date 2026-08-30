import { Terminal, Sparkles, Calendar, ShoppingBag, Users, BarChart3 } from 'lucide-react';
import Link from 'next/link';

const quickStats = [
  { label: 'Reservas hoy', value: '0', icon: Calendar, href: '/reservas' },
  { label: 'Servicios activos', value: '0', icon: Sparkles, href: '/servicios' },
  { label: 'Productos', value: '0', icon: ShoppingBag, href: '/productos' },
  { label: 'Clientes', value: '0', icon: Users, href: '/clientes' },
];

export default function DashboardPage() {
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

      <div className="card-accent">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-brand-400 mt-0.5" />
          <div>
            <p className="mono-label mb-1">LOCAL B+</p>
            <h3 className="text-lg font-bold text-white mb-2">
              Únete a Local B+ — todo para{' '}
              <span className="text-brand-400">vivir de esto.</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">⚡</span>
                <p className="text-sm text-slate-400">
                  Los 13 superpoderes: Blindaje anti-invento, Vigilante, Cazador de ventas, Cobros por WhatsApp, Reportes y más
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">📦</span>
                <p className="text-sm text-slate-400">
                  Los 14 bots por giro, listos para revender a $2,000–3,000 c/u
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">📖</span>
                <p className="text-sm text-slate-400">
                  Los 2 cursos + el Kit de Agencia completos
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">💬</span>
                <p className="text-sm text-slate-400">
                  Comunidad + updates continuos de las plantillas
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-6">
              <button className="btn-primary">
                Únete a Local B+ ↗
              </button>
              <span className="text-sm text-slate-500">
                <span className="line-through">$64/mes</span> · un cliente paga tu año
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
