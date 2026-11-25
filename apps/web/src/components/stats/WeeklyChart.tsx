import { type WeeklyDataPoint } from '@/constants/stats';

export interface WeeklyChartProps {
  data: WeeklyDataPoint[];
  /** Cantidad de días que cubre la serie (7 por defecto; con un rango elegido puede ser hasta 366). */
  days?: number;
}

export function WeeklyChart({ data, days = 7 }: WeeklyChartProps) {
  const maxReservas = Math.max(...data.map(d => d.reservas), 1);
  // Con muchos días no entran los números ni todas las etiquetas: se muestran espaciados.
  const dense = data.length > 14;
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-1">{days === 7 ? 'Reservas de la semana' : 'Reservas por día'}</h3>
      <p className="mono-label mb-6">{days === 7 ? 'ÚLTIMOS 7 DÍAS' : `${days} DÍAS`}</p>
      <div className={`flex items-end h-48 ${dense ? 'gap-0.5' : 'gap-3'}`}>
        {data.map((d, i) => (
          <div key={`${d.day}-${i}`} className="flex-1 flex flex-col items-center gap-2">
            {!dense && <span className="text-xs font-mono text-slate-400">{d.reservas}</span>}
            <div
              className="w-full rounded-t-md bg-brand-500/60 hover:bg-brand-500 transition-colors min-h-[4px]"
              style={{ height: `${(d.reservas / maxReservas) * 100}%` }}
            />
            <span className="text-[10px] font-mono text-slate-500 h-3 whitespace-nowrap">{i % labelEvery === 0 ? d.day : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
