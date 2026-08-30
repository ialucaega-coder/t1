import { Building2, Users, BarChart3, DollarSign, Settings, Eye } from 'lucide-react';

const agencyClients = [
  { name: 'Barbería Don Carlos', plan: 'Local B+', bots: 3, status: 'active', revenue: '$2,500/mes' },
  { name: 'Spa Relax', plan: 'Free', bots: 1, status: 'active', revenue: '$1,200/mes' },
  { name: 'Studio Ana', plan: 'Local B+', bots: 2, status: 'active', revenue: '$3,100/mes' },
  { name: 'Clínica Dental Sonrisa', plan: 'Local B+', bots: 4, status: 'active', revenue: '$4,500/mes' },
  { name: 'Gym Fitness Pro', plan: 'Free', bots: 1, status: 'trial', revenue: '$0' },
];

const features = [
  { icon: Eye, title: 'Prospecta con ROI y demo en vivo', description: 'Muéstrale al prospecto cómo funcionaría su bot antes de cerrar.' },
  { icon: DollarSign, title: 'Monta, cotiza y propon con tu marca', description: 'Propuestas white-label con tu logo y colores.' },
  { icon: Settings, title: 'Configura, enciende superpoderes y cobra', description: 'Todo desde un solo panel, sin cambiar de cuenta.' },
  { icon: BarChart3, title: 'Retén con reporte de valor mensual', description: 'Cada cliente recibe un reporte automático de lo que su bot hizo.' },
];

export default function AgenciaPage() {
  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-400 max-w-2xl">
        Convierte tus bots en un negocio: administra a cada cliente en un solo lugar,
        y cotiza, propon y cóbrale sin salir de aquí.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.title} className="card-accent">
              <Icon className="h-5 w-5 text-brand-400 mb-3" />
              <h4 className="text-sm font-semibold text-white mb-1">{feature.title}</h4>
              <p className="text-xs text-slate-400">{feature.description}</p>
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="mono-label mb-4">TUS CLIENTES</h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Cliente</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Plan</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Bots</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Estado</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {agencyClients.map((client) => (
                <tr key={client.name} className="border-b border-slate-700/30 hover:bg-surface-100 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-brand-400/20 flex items-center justify-center text-xs font-bold text-brand-400">
                        {client.name.split(' ').slice(-1)[0][0]}
                      </div>
                      <span className="text-sm font-medium text-white">{client.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge border text-[9px] ${
                      client.plan === 'Local B+'
                        ? 'bg-brand-400/10 text-brand-400 border-brand-400/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {client.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{client.bots}</td>
                  <td className="px-4 py-3">
                    <span className={`badge border text-[9px] ${
                      client.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {client.status === 'active' ? 'ACTIVO' : 'TRIAL'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-300">{client.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-accent">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-brand-400" />
          <div>
            <p className="text-sm text-white font-medium">Resumen de agencia</p>
            <p className="text-xs text-slate-400">5 clientes · 11 bots activos · $11,300/mes en ingresos recurrentes</p>
          </div>
        </div>
      </div>
    </div>
  );
}
