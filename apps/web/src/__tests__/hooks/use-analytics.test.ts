/**
 * Pruebas unitarias para el hook `useAnalytics` (`src/hooks/use-analytics.ts`):
 * carga en paralelo de kpi/conversaciones/satisfacción/mejoras/costos/métricas,
 * error con fallback a constantes y refetch. Se mockea `analyticsApi`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  analyticsApi: {
    getKpi: vi.fn(),
    getConversations: vi.fn(),
    getSatisfaction: vi.fn(),
    getImprovements: vi.fn(),
    getCosts: vi.fn(),
    getMetrics: vi.fn(),
  },
}));

import { useAnalytics } from '@/hooks/use-analytics';
import { analyticsApi } from '@/lib/api/index';

const mockKpi = analyticsApi.getKpi as ReturnType<typeof vi.fn>;
const mockConv = analyticsApi.getConversations as ReturnType<typeof vi.fn>;
const mockSat = analyticsApi.getSatisfaction as ReturnType<typeof vi.fn>;
const mockImp = analyticsApi.getImprovements as ReturnType<typeof vi.fn>;
const mockCosts = analyticsApi.getCosts as ReturnType<typeof vi.fn>;
const mockMetrics = analyticsApi.getMetrics as ReturnType<typeof vi.fn>;

function resolveAll() {
  mockKpi.mockResolvedValue({ total: 10 });
  mockConv.mockResolvedValue([{ day: 'lun', count: 1 }]);
  mockSat.mockResolvedValue([{ label: 'ok', value: 5 }]);
  mockImp.mockResolvedValue([{ id: 'i1' }]);
  mockCosts.mockResolvedValue([{ provider: 'openai', cost: 3 }]);
  mockMetrics.mockResolvedValue([{ label: 'Latencia', value: '120ms' }]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-analytics', () => {
  it('inicia en estado de carga', () => {
    mockKpi.mockReturnValue(new Promise(() => {}));
    mockConv.mockReturnValue(new Promise(() => {}));
    mockSat.mockReturnValue(new Promise(() => {}));
    mockImp.mockReturnValue(new Promise(() => {}));
    mockCosts.mockReturnValue(new Promise(() => {}));
    mockMetrics.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAnalytics());
    expect(result.current.isLoading).toBe(true);
  });

  it('carga todos los datos desde la API', async () => {
    resolveAll();

    const { result } = renderHook(() => useAnalytics());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kpi).toEqual({ total: 10 });
    expect(result.current.conversations).toEqual([{ day: 'lun', count: 1 }]);
    expect(result.current.satisfaction).toEqual([{ label: 'ok', value: 5 }]);
    expect(result.current.improvements).toEqual([{ id: 'i1' }]);
    expect(result.current.costs).toEqual([{ provider: 'openai', cost: 3 }]);
    expect(result.current.metrics).toEqual([{ label: 'Latencia', value: '120ms' }]);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y deja las métricas vacías', async () => {
    mockKpi.mockRejectedValue(new Error('Falló KPI'));
    mockConv.mockResolvedValue([]);
    mockSat.mockResolvedValue([]);
    mockImp.mockResolvedValue([]);
    mockCosts.mockResolvedValue([]);
    mockMetrics.mockResolvedValue([]);

    const { result } = renderHook(() => useAnalytics());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Falló KPI');
    expect(result.current.metrics).toEqual([]);
  });

  it('refetch vuelve a pedir los datos', async () => {
    resolveAll();

    const { result } = renderHook(() => useAnalytics());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockKpi).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockKpi).toHaveBeenCalledTimes(2));
  });
});
