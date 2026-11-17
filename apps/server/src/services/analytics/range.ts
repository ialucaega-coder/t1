/**
 * Resuelve el rango de fechas (ya validado por `dateRangeQuerySchema`) a las
 * ventanas que usan los endpoints de analytics/stats. Reutiliza los helpers de
 * día calendario en hora de Argentina de `./time` (mismo criterio que las series SQL).
 */
import type { Prisma } from '@prisma/client';
import type { DateRangeQuery } from '../../validators/dateRange';
import { arDateKey, arDayKeys, arDayStartUtc } from './time';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedRange {
  /** true si el cliente pidió un rango (days o from/to); false = comportamiento histórico. */
  custom: boolean;
  /** Cantidad de días calendario de la ventana. */
  days: number;
  /** Días `YYYY-MM-DD` (hora Argentina), el más viejo primero. Para las series por día. */
  keys: string[];
  /** Inicio (inclusive) de la ventana. Sin rango pedido: ahora - N días (ventana móvil histórica). */
  since: Date;
  /** Fin (exclusivo) de la ventana; null = sin tope superior (comportamiento histórico). */
  until: Date | null;
  /** Ventana anterior de igual largo, para las variaciones: [prevSince, prevUntil). */
  prevSince: Date;
  prevUntil: Date;
}

/** Suma `n` días a una fecha `YYYY-MM-DD`. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Las fechas `YYYY-MM-DD` de `from` a `to`, ambas inclusive. */
export function dayKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k);
  return keys;
}

/**
 * @param query       rango validado (puede ser undefined/vacío).
 * @param defaultDays largo histórico del endpoint (30 para KPIs, 7 y 14 para las series).
 */
export function resolveRange(
  query: DateRangeQuery | undefined,
  defaultDays: number,
  now: Date = new Date(),
): ResolvedRange {
  const today = arDateKey(now);

  if (query?.days !== undefined || query?.from !== undefined) {
    let keys: string[];
    if (query.days !== undefined) {
      keys = arDayKeys(query.days, now);
    } else {
      const to = query.to !== undefined && query.to < today ? query.to : today;
      keys = dayKeysBetween(query.from as string, to);
    }
    const since = arDayStartUtc(keys[0]);
    const until = arDayStartUtc(addDays(keys[keys.length - 1], 1));
    return {
      custom: true,
      days: keys.length,
      keys,
      since,
      until,
      prevSince: new Date(since.getTime() - keys.length * DAY_MS),
      prevUntil: since,
    };
  }

  const keys = arDayKeys(defaultDays, now);
  const since = new Date(now.getTime() - defaultDays * DAY_MS);
  return {
    custom: false,
    days: defaultDays,
    keys,
    since,
    until: null,
    prevSince: new Date(now.getTime() - 2 * defaultDays * DAY_MS),
    prevUntil: since,
  };
}

/** Filtro Prisma de fecha para la ventana actual. */
export function windowFilter(range: ResolvedRange): Prisma.DateTimeFilter {
  return { gte: range.since, ...(range.until ? { lt: range.until } : {}) };
}

/** Filtro Prisma de fecha para la ventana anterior. */
export function prevWindowFilter(range: ResolvedRange): Prisma.DateTimeFilter {
  return { gte: range.prevSince, lt: range.prevUntil };
}
