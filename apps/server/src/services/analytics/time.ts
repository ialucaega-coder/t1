/**
 * Días calendario en hora de Argentina para las series de analytics.
 *
 * Antes se agrupaba por el "día local" del servidor: en Cloud Run (UTC) un mensaje
 * de las 22:00 del lunes en Argentina caía en el martes. Argentina es UTC-3 fijo
 * (sin horario de verano), así que el inicio de cada día es siempre 03:00 UTC y el
 * agrupado en SQL usa la misma zona.
 */
export const ANALYTICS_TZ = 'America/Argentina/Buenos_Aires';
const AR_UTC_OFFSET_HOURS = 3;

/** Fecha `YYYY-MM-DD` de un instante, en hora de Argentina. */
export function arDateKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Las últimas `days` fechas `YYYY-MM-DD` (hora Argentina), la más vieja primero y hoy al final. */
export function arDayKeys(days: number, now: Date = new Date()): string[] {
  const [y, m, d] = arDateKey(now).split('-').map(Number);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  }
  return keys;
}

/** Instante UTC en que empieza el día `YYYY-MM-DD` en Argentina (00:00 AR = 03:00 UTC). */
export function arDayStartUtc(key: string): Date {
  return new Date(`${key}T0${AR_UTC_OFFSET_HOURS}:00:00.000Z`);
}

/** Etiqueta del día (p. ej. "mar") para una fecha `YYYY-MM-DD`. */
export function arWeekdayLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' });
}

/** Etiqueta `dd/mm` para una fecha `YYYY-MM-DD`. */
export function arDayMonthLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}
