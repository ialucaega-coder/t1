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
