'use client';

import { useState } from 'react';
import { Calendar, Download } from 'lucide-react';
import {
  PRESET_DAYS,
  MAX_RANGE_DAYS,
  todayLocalKey,
  validateCustomRange,
  type RangeSelection,
} from '@/lib/date-range';

export interface DateRangeBarProps {
  value: RangeSelection;
  onChange: (next: RangeSelection) => void;
  /** Si viene, muestra el botón "Exportar CSV" (exporta lo que se ve, ya cargado). */
  onExport?: () => void;
  exportDisabled?: boolean;
}

const chip = (active: boolean) =>
  `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
    active
      ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
      : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
  }`;

/**
 * Selector de rango (predeterminado / 7 / 30 / 90 días / fechas personalizadas) y
 * botón de exportación CSV. Las fechas personalizadas solo se aplican al tocar
 * "Aplicar" (así no se dispara un pedido por cada tecla) y se validan acá mismo
 * con el mismo tope que el server.
 */
export function DateRangeBar({ value, onChange, onExport, exportDisabled }: DateRangeBarProps) {
  const [customOpen, setCustomOpen] = useState(value.kind === 'custom');
  const [from, setFrom] = useState(value.kind === 'custom' ? value.from : '');
  const [to, setTo] = useState(value.kind === 'custom' ? value.to : '');
  const [error, setError] = useState<string | null>(null);
  const today = todayLocalKey();

  function applyCustom() {
    const problem = validateCustomRange(from, to);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onChange({ kind: 'custom', from, to });
  }

  return (
    <div className="space-y-2" role="group" aria-label="Rango de fechas">
      <div className="flex flex-wrap items-center gap-2">
        <Calendar className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <button
          type="button"
          className={chip(value.kind === 'default')}
          aria-pressed={value.kind === 'default'}
          onClick={() => { setCustomOpen(false); setError(null); onChange({ kind: 'default' }); }}
        >
          Predeterminado
        </button>
        {PRESET_DAYS.map((days) => {
          const active = value.kind === 'preset' && value.days === days;
          return (
            <button
              key={days}
              type="button"
              className={chip(active)}
              aria-pressed={active}
              onClick={() => { setCustomOpen(false); setError(null); onChange({ kind: 'preset', days }); }}
            >
              {days} días
            </button>
          );
        })}
        <button
          type="button"
          className={chip(value.kind === 'custom' || customOpen)}
          aria-pressed={value.kind === 'custom'}
          onClick={() => setCustomOpen((o) => !o)}
        >
          Personalizado
        </button>
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={exportDisabled}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </button>
        )}
      </div>

      {customOpen && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">
            Desde
            <input
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="input block mt-1"
            />
          </label>
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">
            Hasta
            <input
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="input block mt-1"
            />
          </label>
          <button type="button" onClick={applyCustom} className="btn-primary text-xs">
            Aplicar
          </button>
          <span className="text-[10px] text-slate-500">Máximo {MAX_RANGE_DAYS} días.</span>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
