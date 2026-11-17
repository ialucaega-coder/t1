/**
 * Pruebas unitarias para el hook `useBots` (`src/hooks/use-bots.ts`):
 * carga, error, refetch y create/update/delete (que recargan la lista tras la
 * operación). Se mockea el módulo de API `@/lib/api/bots`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/bots', () => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

import { useBots } from '@/hooks/use-bots';
import * as botsApi from '@/lib/api/bots';

const mockList = botsApi.list as ReturnType<typeof vi.fn>;
const mockCreate = botsApi.create as ReturnType<typeof vi.fn>;
const mockUpdate = botsApi.update as ReturnType<typeof vi.fn>;
const mockRemove = botsApi.remove as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-bots', () => {
  it('inicia en estado de carga', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useBots());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.bots).toEqual([]);
  });

  it('carga los bots desde la API', async () => {
    const fake = [{ id: 'b1', name: 'Soporte' }];
    mockList.mockResolvedValue(fake);

    const { result } = renderHook(() => useBots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bots).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y vacía la lista', async () => {
    mockList.mockRejectedValue(new Error('Sin conexión'));

    const { result } = renderHook(() => useBots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin conexión');
    expect(result.current.bots).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockList.mockRejectedValue('x');

    const { result } = renderHook(() => useBots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar bots');
  });

  it('createBot crea y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'b2' });

    const { result } = renderHook(() => useBots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockList).toHaveBeenCalledTimes(1);

    const payload = { name: 'Nuevo', description: null, channel: 'WEBCHAT' as const };
    await act(async () => { await result.current.createBot(payload); });

    expect(mockCreate).toHaveBeenCalledWith(payload);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('updateBot actualiza y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({ id: 'b1' });

    const { result } = renderHook(() => useBots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.updateBot('b1', { name: 'Editado' }); });

    expect(mockUpdate).toHaveBeenCalledWith('b1', { name: 'Editado' });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('deleteBot elimina y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useBots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.deleteBot('b1'); });

    expect(mockRemove).toHaveBeenCalledWith('b1');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});
