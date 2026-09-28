/**
 * Pruebas unitarias para el hook `useSuperpowers` (`src/hooks/use-superpowers.ts`):
 * carga con mapeo de iconName->icono, error con fallback al catálogo local y
 * refetch. Se mockea el namespace `superpowersApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  superpowersApi: {
    getSuperpowers: vi.fn(),
  },
}));

import { useSuperpowers } from '@/hooks/use-superpowers';
import { superpowersApi } from '@/lib/api/index';

const mockGet = superpowersApi.getSuperpowers as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-superpowers', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSuperpowers());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.superpowers).toEqual([]);
  });

  it('carga y mapea los superpoderes asignando un icono', async () => {
    mockGet.mockResolvedValue([
      { name: 'Auto-respuesta', subtitle: 'Sub', description: 'Desc', isActive: false },
    ]);

    const { result } = renderHook(() => useSuperpowers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.superpowers).toHaveLength(1);
    const sp = result.current.superpowers[0];
    expect(sp.name).toBe('Auto-respuesta');
    expect(sp.subtitle).toBe('Sub');
    expect(sp.description).toBe('Desc');
    expect(sp.isActive).toBe(false);
    expect(sp.icon).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y hace fallback al catálogo local', async () => {
    mockGet.mockRejectedValue(new Error('Timeout'));

    const { result } = renderHook(() => useSuperpowers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Timeout');
    expect(result.current.superpowers.length).toBeGreaterThan(0);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue({});

    const { result } = renderHook(() => useSuperpowers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar superpoderes');
  });

  it('refetch vuelve a pedir los superpoderes', async () => {
    mockGet.mockResolvedValue([]);

    const { result } = renderHook(() => useSuperpowers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
