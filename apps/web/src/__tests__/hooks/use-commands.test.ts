/**
 * Pruebas unitarias para el hook `useCommands` (`src/hooks/use-commands.ts`):
 * carga, error con fallback al catálogo local y refetch. Se mockea el namespace
 * `commandsApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  commandsApi: {
    getCommands: vi.fn(),
  },
}));

import { useCommands } from '@/hooks/use-commands';
import { commandsApi } from '@/lib/api/index';

const mockGet = commandsApi.getCommands as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-commands', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCommands());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.commands).toEqual([]);
  });

  it('carga los comandos desde la API', async () => {
    const fake = [{ category: 'Reservas', commands: [] }];
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => useCommands());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.commands).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y deja la lista vacía (sin datos falsos)', async () => {
    mockGet.mockRejectedValue(new Error('Sin conexión'));

    const { result } = renderHook(() => useCommands());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin conexión');
    expect(result.current.commands).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue('x');

    const { result } = renderHook(() => useCommands());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar comandos');
  });

  it('refetch vuelve a pedir los comandos', async () => {
    mockGet.mockResolvedValue([]);

    const { result } = renderHook(() => useCommands());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
