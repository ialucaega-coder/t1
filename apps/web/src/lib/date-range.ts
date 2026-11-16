/**
 * Selección de rango de fechas para analítica/estadísticas y su traducción a los
 * query params de la API (`?days=N` o `?from=YYYY-MM-DD&to=YYYY-MM-DD`).
 * Sin selección ('default') no se manda nada y el server usa su ventana histórica.
 */

/** Tope que acepta el server (días calendario, ambos extremos incluidos). */
export const MAX_RANGE_DAYS = 366;

export const PRESET_DAYS = [7, 30, 90] as const;
export type PresetDays = (typeof PRESET_DAYS)[number];

export type RangeSelection =
  | { kind: 'default' }
  | { kind: 'preset'; days: PresetDays }
  | { kind: 'custom'; from: string; to: string };

export const DEFAULT_RANGE: RangeSelection = { kind: 'default' };

/** Query params que entiende la API. */
export interface RangeParams {
  days?: number;
  from?: string;
  to?: string;
}

/** Params de la API para una selección (undefined = sin rango, comportamiento histórico). */
export function rangeParams(sel: RangeSelection | undefined): RangeParams | undefined {
  if (!sel || sel.kind === 'default') return undefined;
  if (sel.kind === 'preset') return { days: sel.days };
  return { from: sel.from, to: sel.to };
}

/** Query string (con `?`) para los params; '' si no hay rango. */
export function rangeQuery(params: RangeParams | undefined): string {
  if (!params) return '';
  const q = new URLSearchParams();
  if (params.days !== undefined) q.set('days', String(params.days));
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Clave estable de una selección (para dependencias de efectos y nombres de archivo). */
export function rangeKey(sel: RangeSelection | undefined): string {
  if (!sel || sel.kind === 'default') return 'default';
  if (sel.kind === 'preset') return `d${sel.days}`;
  return `${sel.from}_${sel.to}`;
}

/** Fecha local `YYYY-MM-DD` (para el `max` de los inputs de fecha). */
export function todayLocalKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Días entre dos fechas `YYYY-MM-DD`, ambas incluidas. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Mensaje de error si el rango personalizado no es válido; null si está bien. */
export function validateCustomRange(from: string, to: string): string | null {
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDay.test(from) || !isoDay.test(to)) return 'Elegí las dos fechas.';
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return 'Las fechas no son válidas.';
  }
  if (from > to) return 'La fecha "desde" no puede ser posterior a "hasta".';
  if (inclusiveDays(from, to) > MAX_RANGE_DAYS) return `El rango no puede superar ${MAX_RANGE_DAYS} días.`;
  return null;
}

/** Texto corto del rango para títulos y nombres de archivo. */
export function rangeLabel(sel: RangeSelection | undefined): string {
  if (!sel || sel.kind === 'default') return 'Período predeterminado';
  if (sel.kind === 'preset') return `Últimos ${sel.days} días`;
  return `${sel.from} a ${sel.to}`;
}
