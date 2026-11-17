/** Rango de fechas del cliente: params de la API, query string y validación del rango personalizado. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/http-client', () => ({ httpClient: { get: vi.fn() } }));

import {
  rangeParams, rangeQuery, rangeKey, validateCustomRange, inclusiveDays, MAX_RANGE_DAYS,
} from '@/lib/date-range';
import { httpClient } from '@/lib/api/http-client';
import * as analyticsApi from '@/lib/api/analytics';
import * as statsApi from '@/lib/api/stats';

const get = httpClient.get as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('lib/date-range', () => {
  it('sin selección o "default" no manda parámetros', () => {
    expect(rangeParams(undefined)).toBeUndefined();
    expect(rangeParams({ kind: 'default' })).toBeUndefined();
    expect(rangeQuery(undefined)).toBe('');
  });

  it('un preset manda days y un rango personalizado manda from/to', () => {
    expect(rangeParams({ kind: 'preset', days: 30 })).toEqual({ days: 30 });
    expect(rangeQuery({ days: 30 })).toBe('?days=30');
    expect(rangeQuery(rangeParams({ kind: 'custom', from: '2026-10-01', to: '2026-10-31' }))).toBe('?from=2026-10-01&to=2026-10-31');
  });

  it('rangeKey distingue cada selección', () => {
    const keys = [
      rangeKey({ kind: 'default' }),
      rangeKey({ kind: 'preset', days: 7 }),
      rangeKey({ kind: 'custom', from: '2026-10-01', to: '2026-10-02' }),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it('validateCustomRange: ok, vacío, invertido y más de 366 días', () => {
    expect(validateCustomRange('2026-10-01', '2026-10-31')).toBeNull();
    expect(validateCustomRange('', '2026-10-31')).toMatch(/dos fechas/);
    expect(validateCustomRange('2026-10-31', '2026-10-01')).toMatch(/posterior/);
    expect(validateCustomRange('2024-01-01', '2026-01-01')).toMatch(String(MAX_RANGE_DAYS));
    expect(inclusiveDays('2026-10-01', '2026-10-01')).toBe(1);
  });

  it('la API de analytics y la de stats agregan el rango a la URL; sin rango la dejan igual', () => {
    analyticsApi.getKpi({ days: 7 });
    analyticsApi.getTimeseries({ from: '2026-10-01', to: '2026-10-05' });
    analyticsApi.getKpi();
    statsApi.getWeeklyStats({ days: 90 });
    statsApi.getTopServices();
    expect(get.mock.calls.map(([u]) => u)).toEqual([
      '/analytics/kpi?days=7',
      '/analytics/timeseries?from=2026-10-01&to=2026-10-05',
      '/analytics/kpi',
      '/stats/weekly?days=90',
      '/stats/top-services',
    ]);
  });
});
