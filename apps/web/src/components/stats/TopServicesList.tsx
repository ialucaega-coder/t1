import { type TopService } from '@/types';

export interface TopServicesListProps {
  /** Servicios más reservados provenientes de la API (vacío = sin reservas en el período). */
  services?: TopService[];
  /** Período que cubre la lista (p. ej. "este mes" o "2026-10-01 a 2026-10-31"), para el estado vacío. */
  periodText?: string;
}

export function TopServicesList({ services, periodText }: TopServicesListProps) {
  const items = (services ?? []).map((s) => ({ id: s.id ?? s.name, name: s.name, count: s.bookingCount }));
  const maxCount = Math.max(...items.map((it) => it.count), 1);

  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-1">Top servicios</h3>
      <p className="mono-label mb-4">MÁS RESERVADOS</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">
          Todavía no hay reservas en este período{periodText ? ` (${periodText})` : ''}.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-3">
              <span className="text-xs font-mono text-slate-500 w-4">{i + 1}</span>
              <div className="flex-1">
                <p className="text-sm text-white">{item.name}</p>
                <div className="mt-1 h-1.5 rounded-full bg-surface-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${(item.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-xs font-mono text-slate-400">{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
