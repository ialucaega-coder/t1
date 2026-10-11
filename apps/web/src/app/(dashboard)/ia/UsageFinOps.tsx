'use client';

/**
 * Panel de FinOps de IA: muestra el consumo real de tokens del bot y una
 * estimación de costo (precios de lista públicos), agregado por día y por modelo.
 * Se calcula en el backend (services/ai/usage.ts) desde message.metadata.usage.
 */
import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, MessageSquare, Hash, Gauge, AlertTriangle } from 'lucide-react';
import * as aiApi from '@/lib/api/ai';
import type { UsageSummary, MessageQuota } from '@/lib/api/ai';

const RANGES = [7, 30, 90] as const;

const fmtInt = (n: number) => new Intl.NumberFormat('es-AR').format(n);
const fmtUsd = (n: number) =>
  n > 0 && n < 0.01 ? '<$0.01' : `$${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export function UsageFinOps() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageSummary | null>(null);
  const [quota, setQuota] = useState<MessageQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await aiApi.getUsage(d));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el consumo de IA');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  // El cupo mensual del plan no depende del rango de días: se carga una vez.
  useEffect(() => {
    let cancelled = false;
    aiApi.getQuota()
      .then((q) => { if (!cancelled) setQuota(q); })
      .catch(() => { /* auxiliar: si falla, no mostramos la barra de cupo */ });
    return () => { cancelled = true; };
  }, []);

  const maxDayCost = data ? Math.max(...data.byDay.map((d) => d.estimatedCostUsd), 0) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <p className="mono-label mb-1">COSTO DE IA · FINOPS</p>
          <h3 className="text-lg font-bold text-white">Consumo y costo estimado</h3>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700/60 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                days === r ? 'bg-brand-400/15 text-brand-400 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        {quota && <QuotaBar quota={quota} />}
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando consumo...
          </div>
        ) : error ? (
          <p className="text-sm text-red-400 py-4">{error}</p>
        ) : !data || data.totalMessages === 0 ? (
          <p className="text-sm text-slate-500 py-4">
            Todavía no hay consumo de IA registrado en este período. Cuando tu bot responda con un modelo
            configurado, acá vas a ver los tokens usados y el costo estimado.
          </p>
        ) : (
          <>
            {/* Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Tile icon={<Coins className="h-4 w-4" />} label="Costo estimado" value={fmtUsd(data.estimatedCostUsd)} accent />
              <Tile icon={<Hash className="h-4 w-4" />} label="Tokens (in + out)" value={fmtInt(data.totalInputTokens + data.totalOutputTokens)} />
              <Tile icon={<MessageSquare className="h-4 w-4" />} label="Respuestas del bot" value={fmtInt(data.totalMessages)} />
            </div>

            {/* Barras por día */}
            {data.byDay.length > 0 && (
              <div>
                <p className="section-label">COSTO POR DÍA</p>
                <div className="flex items-end gap-1 h-24">
                  {data.byDay.map((d) => (
                    <div key={d.day} className="flex-1 flex flex-col items-center justify-end group relative" title={`${d.day}: ${fmtUsd(d.estimatedCostUsd)} · ${fmtInt(d.messages)} msj`}>
                      <div
                        className="w-full rounded-t bg-brand-400/70 group-hover:bg-brand-400 transition-colors min-h-[2px]"
                        style={{ height: `${maxDayCost > 0 ? Math.max((d.estimatedCostUsd / maxDayCost) * 100, 2) : 2}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>{data.byDay[0]?.day.slice(5)}</span>
                  <span>{data.byDay[data.byDay.length - 1]?.day.slice(5)}</span>
                </div>
              </div>
            )}

            {/* Desglose por modelo */}
            <div>
              <p className="section-label">POR MODELO</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase text-slate-500 text-left">
                      <th className="font-medium py-1.5 pr-2">Modelo</th>
                      <th className="font-medium py-1.5 px-2 text-right tabular-nums">Tokens in</th>
                      <th className="font-medium py-1.5 px-2 text-right tabular-nums">Tokens out</th>
                      <th className="font-medium py-1.5 px-2 text-right tabular-nums">Respuestas</th>
                      <th className="font-medium py-1.5 pl-2 text-right tabular-nums">Costo est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={m.model} className="border-t border-slate-800">
                        <td className="py-1.5 pr-2 text-white font-mono text-xs">{m.model}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">{fmtInt(m.inputTokens)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">{fmtInt(m.outputTokens)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">{fmtInt(m.messages)}</td>
                        <td className="py-1.5 pl-2 text-right text-brand-400 font-semibold tabular-nums">{fmtUsd(m.estimatedCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              El costo es una <span className="text-slate-400">estimación</span> con precios de lista públicos por modelo;
              puede diferir de tu factura real del proveedor.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Barra de cupo mensual de mensajes del plan (uso / límite). */
function QuotaBar({ quota }: { quota: MessageQuota }) {
  const pct = quota.limit > 0 ? Math.min((quota.used / quota.limit) * 100, 100) : 0;
  const near = pct >= 80 && !quota.overQuota;
  const barColor = quota.overQuota ? 'bg-red-500' : near ? 'bg-amber-400' : 'bg-brand-400';
  const renewal = quota.periodEnd
    ? new Date(quota.periodEnd).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-3">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
          <Gauge className="h-3.5 w-3.5" /> Cupo mensual del plan
          {quota.plan && <span className="text-slate-600">· {quota.plan}</span>}
        </span>
        <span className="text-xs tabular-nums text-slate-300">
          {fmtInt(quota.used)} / {fmtInt(quota.limit)} mensajes
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-700/50 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
        {quota.overQuota ? (
          <span className="flex items-center gap-1 text-[11px] text-red-400">
            <AlertTriangle className="h-3 w-3" /> Cupo agotado: el bot deja de responder hasta la renovación.
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">{fmtInt(quota.remaining)} restantes</span>
        )}
        {renewal && <span className="text-[11px] text-slate-500">Renueva el {renewal}</span>}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-3">
      <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide mb-1 ${accent ? 'text-brand-400' : 'text-slate-500'}`}>
        {icon} {label}
      </div>
      <p className={`text-xl font-bold tabular-nums ${accent ? 'text-brand-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}
