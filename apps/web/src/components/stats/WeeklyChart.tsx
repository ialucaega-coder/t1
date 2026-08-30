import { type WeeklyDataPoint } from '@/constants/stats';

export interface WeeklyChartProps {
  data: WeeklyDataPoint[];
}

export function WeeklyChart({ data }: WeeklyChartProps) {
  const maxReservas = Math.max(...data.map(d => d.reservas));

  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-1">Reservas de la semana</h3>
      <p className="mono-label mb-6">ÚLTIMOS 7 DÍAS</p>
      <div className="flex items-end gap-3 h-48">
        {data.map((d) => (
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
  );
}
