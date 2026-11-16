'use client';

/**
 * Tope mensual de gasto de IA del negocio (USD).
 * - Muestra el gasto estimado del mes contra el tope, con barra de progreso
 *   (ámbar desde 80 %, rojo al 100 %) y una etiqueta de texto además del color.
 * - Solo el ADMIN puede fijar o quitar el tope; el resto lo ve en lectura.
 */
import { useState } from 'react';
import { Gauge, Loader2, AlertTriangle, OctagonAlert, CheckCircle2, Info } from 'lucide-react';
import { useSpendCap } from '@/hooks/use-spend-cap';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/common/Toast';
import type { SpendLevel } from '@/lib/api/ai';

export const MAX_CAP_USD = 100_000;

const fmtUsd = (n: number) =>
  `US$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

/**
 * Valida el texto del input. Acepta coma o punto decimal. Devuelve el número o
 * un mensaje de error (el server exige > 0 y <= MAX_CAP_USD; para no tener tope
 * se usa "Quitar tope").
 */
export function parseCapInput(raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(',', '.');
  if (!text) return { error: 'Ingresá un monto en dólares.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { error: 'Ingresá un número válido, sin signos y con hasta 2 decimales.' };
  }
  const value = Number(text);
  if (value <= 0) return { error: 'El tope tiene que ser mayor a 0. Para no tener tope, usá "Quitar tope".' };
  if (value > MAX_CAP_USD) {
    return { error: `El tope máximo es US$ ${new Intl.NumberFormat('es-AR').format(MAX_CAP_USD)}.` };
  }
  return { value };
}

const LEVEL_UI: Record<SpendLevel, { label: string; bar: string; text: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'Dentro del tope', bar: 'bg-brand-400', text: 'text-emerald-400', Icon: CheckCircle2 },
  warn: { label: 'Cerca del tope (80 % o más)', bar: 'bg-amber-400', text: 'text-amber-400', Icon: AlertTriangle },
  blocked: { label: 'Tope alcanzado (100 %)', bar: 'bg-red-500', text: 'text-red-400', Icon: OctagonAlert },
};

export function SpendCapCard() {
  const { status, isLoading, error, refetch, save } = useSpendCap();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasCap = status?.capUsd != null;
  const pct = status && hasCap && status.ratio != null ? Math.round(status.ratio * 100) : 0;
  const level = status?.level ?? 'ok';
  const ui = LEVEL_UI[level];

  async function handleSave() {
    const parsed = parseCapInput(draft);
    if ('error' in parsed) {
      setDraftError(parsed.error);
      return;
    }
    setDraftError(null);
    setSaving(true);
    try {
      await save(parsed.value);
      setDraft('');
      toast({ type: 'success', message: `Tope mensual fijado en ${fmtUsd(parsed.value)}` });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'No se pudo guardar el tope' });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setDraftError(null);
    setSaving(true);
    try {
      await save(null);
      setDraft('');
      toast({ type: 'success', message: 'Quitaste el tope: ahora no hay límite de gasto mensual' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'No se pudo quitar el tope' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-2">
        <p className="mono-label mb-1">TOPE DE GASTO DE IA</p>
        <h3 className="text-lg font-bold text-white">Límite mensual en dólares</h3>
      </div>

      <div className="card space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando tope de gasto...
          </div>
        ) : error || !status ? (
          <div className="flex items-center justify-between gap-3 py-2">
            <p className="text-sm text-red-400" role="alert">{error ?? 'No se pudo cargar el tope de gasto de IA'}</p>
            <button className="btn-secondary text-xs" onClick={refetch}>Reintentar</button>
          </div>
        ) : (
          <>
            {hasCap ? (
              <div>
                <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
                  <div>
                    <p className="text-xs text-slate-500">Gasto estimado de {status.month}</p>
                    <p className="text-2xl font-bold text-white">
                      {fmtUsd(status.spentUsd)}{' '}
                      <span className="text-sm font-normal text-slate-400">de {fmtUsd(status.capUsd as number)}</span>
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${ui.text}`}>
                    <ui.Icon className="h-4 w-4" aria-hidden="true" />
                    {ui.label} · {pct} %
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Gasto de IA del mes respecto del tope"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, pct)}
                  aria-valuetext={`${pct} % del tope. ${ui.label}`}
                  className="h-2.5 rounded-full bg-slate-700 overflow-hidden"
                >
                  <div className={`h-full rounded-full transition-all ${ui.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-500">Gasto estimado de {status.month} (aproximado)</p>
                <p className="text-2xl font-bold text-white">{fmtUsd(status.spentUsd)}</p>
                <p className="text-sm text-slate-300 mt-1">Sin tope: el bot no se corta por gasto.</p>
              </div>
            )}

            {isAdmin ? (
              <div>
                <label htmlFor="spend-cap-input" className="text-xs text-slate-400 mb-1 block">
                  {hasCap ? 'Cambiar tope mensual (USD)' : 'Fijar tope mensual (USD)'}
                </label>
                <div className="flex items-start gap-2 flex-wrap">
                  <input
                    id="spend-cap-input"
                    type="text"
                    inputMode="decimal"
                    className="input w-40"
                    placeholder="Ej: 25.00"
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); setDraftError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !saving) handleSave(); }}
                    aria-invalid={draftError ? true : undefined}
                    aria-describedby={draftError ? 'spend-cap-error' : 'spend-cap-help'}
                    disabled={saving}
                  />
                  <button className="btn-primary text-xs py-2.5" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
                    Guardar tope
                  </button>
                  {hasCap && (
                    <button className="btn-secondary text-xs py-2.5" onClick={handleRemove} disabled={saving}>
                      Quitar tope
                    </button>
                  )}
                </div>
                {draftError ? (
                  <p id="spend-cap-error" role="alert" className="text-xs text-red-400 mt-1.5">{draftError}</p>
                ) : (
                  <p id="spend-cap-help" className="text-xs text-slate-500 mt-1.5">
                    Monto mayor a 0, hasta 2 decimales (máximo US$ {new Intl.NumberFormat('es-AR').format(MAX_CAP_USD)}).
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Solo un administrador puede cambiar el tope.</p>
            )}

            <div className="flex items-start gap-2 rounded-lg bg-surface p-3 text-xs text-slate-400">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-slate-500" aria-hidden="true" />
              <ul className="space-y-1 list-disc list-inside">
                <li>Los precios son aproximados: el gasto es una estimación con precios de lista públicos.</li>
                <li>Al 80 % te avisamos. Al 100 % el bot deja de responder solo y deriva la conversación a una persona.</li>
                <li>El tope solo cuenta las respuestas del bot de chat; no incluye el consumo de los agentes de Mr Go.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
