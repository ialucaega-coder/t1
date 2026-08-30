import { type TopService } from '@/types';

const TOP_SERVICES = ['Corte + Peinado', 'Color completo', 'Barba', 'Manicura', 'Tratamiento capilar'];

export interface TopServicesListProps {
  /** Servicios más reservados provenientes de la API. Si se omite, se usa
   * un listado de ejemplo (fallback legacy). */
  services?: TopService[];
}

export function TopServicesList({ services }: TopServicesListProps) {
  const items = services && services.length > 0
    ? services.map((s) => ({ name: s.name, count: s.bookingCount }))
    : TOP_SERVICES.map((name) => ({ name, count: null as number | null }));

  const maxCount = Math.max(...items.map((it) => it.count ?? 0), 1);

  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-1">Top servicios</h3>
      <p className="mono-label mb-4">MÁS RESERVADOS</p>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500 w-4">{i + 1}</span>
            <div className="flex-1">
              <p className="text-sm text-white">{item.name}</p>
              <div className="mt-1 h-1.5 rounded-full bg-surface-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${item.count !== null ? (item.count / maxCount) * 100 : 100 - i * 18}%` }}
                />
              </div>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {item.count !== null ? item.count : Math.floor(Math.random() * 50 + 10)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
