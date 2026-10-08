/**
 * Pruebas del hook `usePos` (`src/hooks/use-pos.ts`): carga los ítems vendibles
 * del POS (servicios + productos), maneja el estado de carga/error y, ante un
 * error, deja la lista vacía y expone el mensaje (sin inventar ítems falsos).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  posApi: { getPosItems: vi.fn() },
}));

import { usePos } from '@/hooks/use-pos';
import { posApi } from '@/lib/api/index';

const mockGet = posApi.getPosItems as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-pos', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePos());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('carga los ítems del POS desde la API', async () => {
    const fake = [{ name: 'Corte', price: 1000, category: 'Servicios' }];
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => usePos());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y deja la lista vacía (sin datos falsos)', async () => {
    mockGet.mockRejectedValue(new Error('API caída'));

    const { result } = renderHook(() => usePos());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('API caída');
    expect(result.current.items).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue('boom');

    const { result } = renderHook(() => usePos());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar productos POS');
    expect(result.current.items).toEqual([]);
  });

  it('refetch vuelve a pedir los ítems a la API', async () => {
    mockGet.mockResolvedValue([{ name: 'Corte', price: 1000, category: 'Servicios' }]);

    const { result } = renderHook(() => usePos());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    mockGet.mockResolvedValue([{ name: 'Barba', price: 500, category: 'Servicios' }]);
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.items[0].name).toBe('Barba'));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
