/**
 * Pruebas unitarias para el hook `usePrompts` (`src/hooks/use-prompts.ts`):
 * carga, error (sin fallback, la lista queda vacía) y refetch. Se mockea el
 * namespace `promptsApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  promptsApi: {
    getPrompts: vi.fn(),
  },
}));

import { usePrompts } from '@/hooks/use-prompts';
import { promptsApi } from '@/lib/api/index';

const mockGet = promptsApi.getPrompts as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-prompts', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePrompts());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.prompts).toEqual([]);
  });

  it('carga los prompts desde la API', async () => {
    const fake = [{ id: 'p1', title: 'Saludo' }];
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => usePrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.prompts).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y deja la lista vacía', async () => {
    mockGet.mockRejectedValue(new Error('Falló'));

    const { result } = renderHook(() => usePrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Falló');
    expect(result.current.prompts).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue(null);

    const { result } = renderHook(() => usePrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar prompts');
  });

  it('refetch vuelve a pedir los prompts', async () => {
    mockGet.mockResolvedValue([]);

    const { result } = renderHook(() => usePrompts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
