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

/** Zona horaria del negocio (Argentina: UTC-3 fijo, sin horario de verano). Igual a ANALYTICS_TZ del server. */
export const BUSINESS_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Fecha `YYYY-MM-DD` de un instante en hora de Argentina, sin depender de la zona
 * del navegador ni del servidor. A las 22:00 AR (01:00Z del día siguiente)
 * `toISOString()` daría la fecha de mañana; esto da la de hoy. Es la que espera la
 * API para `from`/`to` (el server las interpreta como días argentinos).
 */
export function todayArgentinaKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * "Hoy" para el `max` de los selectores de fecha y los nombres de archivo: es el día
 * de Argentina, igual que el que usa el server para interpretar `from`/`to`. Antes
 * usaba la fecha del navegador, que de noche o en otra zona horaria deja elegir un
 * día que el server todavía no considera "hoy" (o bloquea uno que sí lo es).
 * Se mantiene el nombre por compatibilidad con los callers.
 */
export function todayLocalKey(now: Date = new Date()): string {
  return todayArgentinaKey(now);
}

/** Hora (0-23) de un instante en hora de Argentina, sin depender de la zona del navegador. */
export function argentinaHour(iso: string | Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
  return Number(parts);
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
