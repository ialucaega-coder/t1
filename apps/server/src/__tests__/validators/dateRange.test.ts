/** Validación del rango de fechas de analytics/stats (?days | ?from&to). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dateRangeQuerySchema, MAX_RANGE_DAYS } from '../../validators/dateRange';

// 2026-11-02 01:00 UTC = 1/11 22:00 en Argentina ("hoy" AR = 2026-11-01).
const NOW = new Date('2026-11-02T01:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const ok = (q: unknown) => dateRangeQuerySchema.safeParse(q);

describe('validators/dateRange', () => {
  it('sin parámetros es válido (comportamiento histórico)', () => {
    expect(ok({}).success).toBe(true);
  });

  it('acepta un preset days y lo convierte a número', () => {
    const r = ok({ days: '90' });
    expect(r.success).toBe(true);
    expect(r.data?.days).toBe(90);
  });

  it('rechaza days fuera de 1..366 o no entero', () => {
    expect(ok({ days: '0' }).success).toBe(false);
    expect(ok({ days: String(MAX_RANGE_DAYS + 1) }).success).toBe(false);
    expect(ok({ days: '7.5' }).success).toBe(false);
    expect(ok({ days: 'abc' }).success).toBe(false);
  });

  it('acepta from/to válidos y to opcional (hoy)', () => {
    expect(ok({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(ok({ from: '2026-10-01' }).success).toBe(true);
  });

  it('rechaza fechas con formato o calendario inválido', () => {
    expect(ok({ from: '01/10/2026' }).success).toBe(false);
    expect(ok({ from: '2026-02-31' }).success).toBe(false);
  });

  it('rechaza to sin from, from > to y from en el futuro', () => {
    expect(ok({ to: '2026-10-31' }).success).toBe(false);
    expect(ok({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(ok({ from: '2026-11-05' }).success).toBe(false);
  });

  it('rechaza combinar days con from/to', () => {
    expect(ok({ days: '7', from: '2026-10-01' }).success).toBe(false);
  });

  it('tope de rango: 366 días pasa y 367 no', () => {
    // hoy AR = 2026-11-01; 366 días inclusive => from = 2025-11-01.
    expect(ok({ from: '2025-11-01', to: '2026-11-01' }).success).toBe(true); // 366 días
    expect(ok({ from: '2025-10-31', to: '2026-11-01' }).success).toBe(false); // 367 días
  });

  it('una fecha to futura se recorta a hoy (no falla ni agranda el rango)', () => {
    expect(ok({ from: '2025-11-01', to: '2030-01-01' }).success).toBe(true);
    expect(ok({ from: '2025-10-31', to: '2030-01-01' }).success).toBe(false);
  });
});
