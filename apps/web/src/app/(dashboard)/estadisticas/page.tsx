import { TrendingUp, Users, Calendar, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const stats = [
  { label: 'Conversaciones', value: '1,284', change: '+12%', trend: 'up', icon: Users },
  { label: 'Reservas', value: '342', change: '+8%', trend: 'up', icon: Calendar },
  { label: 'Ingresos', value: '$45,200', change: '+23%', trend: 'up', icon: DollarSign },
  { label: 'No-shows', value: '3.2%', change: '-15%', trend: 'down', icon: TrendingUp },
];

const weeklyData = [
  { day: 'Lun', reservas: 12, ventas: 8500 },
  { day: 'Mar', reservas: 15, ventas: 12300 },
  { day: 'Mié', reservas: 18, ventas: 15100 },
  { day: 'Jue', reservas: 14, ventas: 11200 },
  { day: 'Vie', reservas: 22, ventas: 18400 },
  { day: 'Sáb', reservas: 28, ventas: 24600 },
  { day: 'Dom', reservas: 5, ventas: 3200 },
];

const maxReservas = Math.max(...weeklyData.map(d => d.reservas));

export default function EstadisticasPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        El pulso del mes de TODA tu operación — leads, mensajes, conversaciones y salud de cada bot, sumados y leídos en vivo.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card">
              <div className="flex items-center justify-between mb-3">
                <Icon className="h-5 w-5 text-brand-400" />
                <div className={`flex items-center gap-1 text-xs font-medium ${
                  stat.trend === 'up' ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {stat.trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {stat.change}
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3 className="font-semibold text-white mb-1">Reservas de la semana</h3>
        <p className="mono-label mb-6">ÚLTIMOS 7 DÍAS</p>
        <div className="flex items-end gap-3 h-48">
          {weeklyData.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-xs font-mono text-slate-400">{d.reservas}</span>
              <div
                className="w-full rounded-t-md bg-brand-500/60 hover:bg-brand-500 transition-colors min-h-[4px]"
                style={{ height: `${(d.reservas / maxReservas) * 100}%` }}
              />
              <span className="text-[10px] font-mono text-slate-500">{d.day}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold text-white mb-1">Top servicios</h3>
          <p className="mono-label mb-4">MÁS RESERVADOS</p>
          <div className="space-y-3">
            {['Corte + Peinado', 'Color completo', 'Barba', 'Manicura', 'Tratamiento capilar'].map((service, i) => (
              <div key={service} className="flex items-center gap-3">
                <span className="text-xs font-mono text-slate-500 w-4">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm text-white">{service}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${100 - i * 18}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs font-mono text-slate-400">{Math.floor(Math.random() * 50 + 10)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-white mb-1">Salud de la operación</h3>
          <p className="mono-label mb-4">INDICADORES CLAVE</p>
          <div className="space-y-4">
            {[
              { label: 'Tasa de confirmación', value: '94%', good: true },
              { label: 'Tiempo promedio de respuesta', value: '2.3 min', good: true },
              { label: 'Satisfacción del cliente', value: '4.8/5', good: true },
              { label: 'Tasa de no-show', value: '3.2%', good: true },
              { label: 'Retencion mensual', value: '78%', good: false },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{item.label}</span>
                <span className={`text-sm font-medium ${item.good ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
