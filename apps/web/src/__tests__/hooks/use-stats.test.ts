/**
 * Pruebas unitarias para el hook `useStats` (`src/hooks/use-stats.ts`):
 * carga en paralelo de overview/semanal/top-servicios, error y refetch.
 * Se mockea el namespace `statsApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  statsApi: {
    getOverview: vi.fn(),
    getWeeklyStats: vi.fn(),
    getTopServices: vi.fn(),
  },
}));

import { useStats } from '@/hooks/use-stats';
import { statsApi } from '@/lib/api/index';
import type { RangeSelection } from '@/lib/date-range';

const mockOverview = statsApi.getOverview as ReturnType<typeof vi.fn>;
const mockWeekly = statsApi.getWeeklyStats as ReturnType<typeof vi.fn>;
const mockTop = statsApi.getTopServices as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-stats', () => {
  it('inicia en estado de carga', () => {
    mockOverview.mockReturnValue(new Promise(() => {}));
    mockWeekly.mockReturnValue(new Promise(() => {}));
    mockTop.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useStats());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.overview).toBeNull();
    expect(result.current.weeklyData).toEqual([]);
    expect(result.current.topServices).toEqual([]);
  });

  it('carga overview, datos semanales y top servicios', async () => {
    mockOverview.mockResolvedValue({ revenue: 1000 });
    mockWeekly.mockResolvedValue([{ day: 'lun', total: 5 }]);
    mockTop.mockResolvedValue([{ name: 'Corte', count: 12 }]);

    const { result } = renderHook(() => useStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.overview).toEqual({ revenue: 1000 });
    expect(result.current.weeklyData).toEqual([{ day: 'lun', total: 5 }]);
    expect(result.current.topServices).toEqual([{ name: 'Corte', count: 12 }]);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje', async () => {
    mockOverview.mockRejectedValue(new Error('Sin datos'));
    mockWeekly.mockResolvedValue([]);
    mockTop.mockResolvedValue([]);

    const { result } = renderHook(() => useStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin datos');
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockOverview.mockRejectedValue('x');
    mockWeekly.mockResolvedValue([]);
    mockTop.mockResolvedValue([]);

    const { result } = renderHook(() => useStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar estadísticas');
  });

  it('sin rango pide todo sin parámetros; al cambiar el rango recarga con los parámetros nuevos', async () => {
    mockOverview.mockResolvedValue({ revenue: 1 });
    mockWeekly.mockResolvedValue([]);
    mockTop.mockResolvedValue([]);

    const { result, rerender } = renderHook(({ range }) => useStats(range), {
      initialProps: { range: { kind: 'default' } as RangeSelection },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockOverview).toHaveBeenLastCalledWith(undefined);

    rerender({ range: { kind: 'preset', days: 30 } });
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(2));
    expect(mockOverview).toHaveBeenLastCalledWith({ days: 30 });
    expect(mockWeekly).toHaveBeenLastCalledWith({ days: 30 });
    expect(mockTop).toHaveBeenLastCalledWith({ days: 30 });

    rerender({ range: { kind: 'custom', from: '2026-10-01', to: '2026-10-31' } });
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(3));
    expect(mockOverview).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('refetch vuelve a pedir las estadísticas', async () => {
    mockOverview.mockResolvedValue({ revenue: 1 });
    mockWeekly.mockResolvedValue([]);
    mockTop.mockResolvedValue([]);

    const { result } = renderHook(() => useStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockOverview).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(2));
  });
});
