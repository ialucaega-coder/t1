'use client';

/**
 * Super Admin: gasto de IA del mes por negocio, con su tope y estado.
 * Se monta solo dentro de /plataforma, que ya muestra "Acceso restringido" a
 * quien no es admin de plataforma; el endpoint además está protegido en el server.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import * as aiApi from '@/lib/api/ai';
import type { SpendOverview, SpendOverviewRow } from '@/lib/api/ai';

type SortKey = 'ratio' | 'spent';

const fmtUsd = (n: number) =>
  `US$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export function rowStatus(row: SpendOverviewRow): { label: string; cls: string } {
  if (row.capUsd == null || row.ratio == null) return { label: 'Sin tope', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  if (row.level === 'blocked') return { label: 'Tope alcanzado (100 %)', cls: 'bg-red-500/10 text-red-400 border-red-500/30' };
  if (row.level === 'warn') return { label: 'Cerca del tope (80 %)', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
  return { label: 'Normal', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
}

export function SpendOverviewPanel() {
  const [data, setData] = useState<SpendOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('ratio');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await aiApi.getSpendOverview());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'No se pudo cargar el gasto de IA por negocio');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const list = [...(data?.businesses ?? [])];
    // Los negocios sin tope tienen ratio 0: al ordenar por % quedan al final y se desempatan por gasto.
    list.sort((a, b) => {
      if (sortBy === 'spent') return b.spentUsd - a.spentUsd;
      // Por %: los negocios sin tope (ratio null) van al final y se ordenan entre sí por gasto.
      if (a.ratio == null && b.ratio == null) return b.spentUsd - a.spentUsd;
      if (a.ratio == null) return 1;
      if (b.ratio == null) return -1;
      return b.ratio - a.ratio || b.spentUsd - a.spentUsd;
    });
    return list;
  }, [data, sortBy]);

  return (
    <section aria-labelledby="spend-overview-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="mono-label mb-1">GASTO DE IA · TODOS LOS NEGOCIOS</p>
          <h2 id="spend-overview-title" className="text-lg font-bold text-white">
            Gasto del mes{data ? ` (${data.month})` : ''}
          </h2>
          {data && (
            <p className="text-xs text-slate-500">
              Total estimado: {fmtUsd(data.totalUsd)}. Los precios son aproximados.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="spend-sort" className="text-xs text-slate-400">Ordenar por</label>
          <select
            id="spend-sort"
            className="input w-auto text-xs py-1.5"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            <option value="ratio">% del tope usado</option>
            <option value="spent">Gasto del mes</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/50">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando gasto de IA...
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-red-400" role="alert">{error}</p>
            <button className="btn-secondary text-xs" onClick={load}>Reintentar</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">Todavía no hay gasto de IA registrado este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Gasto de IA del mes por negocio</caption>
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th scope="col" className="px-4 py-3 font-medium">Negocio</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Gasto del mes</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Tope</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">% usado</th>
                  <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const st = rowStatus(row);
                  return (
                    <tr key={row.businessId} className="border-b border-slate-700/50">
                      <td className="px-4 py-3 text-white font-medium">{row.name}</td>
                      <td className="px-4 py-3 text-right text-slate-200">{fmtUsd(row.spentUsd)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.capUsd == null ? '—' : fmtUsd(row.capUsd)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.capUsd == null || row.ratio == null ? '—' : `${Math.round(row.ratio * 100)} %`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
