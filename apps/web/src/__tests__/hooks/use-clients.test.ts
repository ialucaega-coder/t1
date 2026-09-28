/**
 * Pruebas unitarias para los hooks de `src/hooks/use-clients.ts`:
 * `useClients` (listado paginado con search) y `useClientDetail` (detalle por id).
 *
 * Estos hooks importan el modulo como namespace (`import * as clientsApi from
 * '@/lib/api/clients'`), por lo que se mockea esa ruta directamente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/clients', () => ({
  getClients: vi.fn(),
  getClient: vi.fn(),
}));

import { useClients, useClientDetail } from '@/hooks/use-clients';
import * as clientsApi from '@/lib/api/clients';

const mockGetClients = clientsApi.getClients as ReturnType<typeof vi.fn>;
const mockGetClient = clientsApi.getClient as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-clients - useClients', () => {
  it('inicia en estado de carga', () => {
    mockGetClients.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useClients());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.clients).toEqual([]);
  });

  it('carga clientes con total y totalPages', async () => {
    mockGetClients.mockResolvedValue({
      data: [{ id: 'c1', name: 'Ana' }],
      total: 1,
      totalPages: 1,
    });

    const { result } = renderHook(() => useClients());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.clients).toEqual([{ id: 'c1', name: 'Ana' }]);
    expect(result.current.total).toBe(1);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('pasa search y page a la API', async () => {
    mockGetClients.mockResolvedValue({ data: [], total: 0, totalPages: 0 });

    renderHook(() => useClients({ search: 'ana', page: 2 }));

    await waitFor(() =>
      expect(mockGetClients).toHaveBeenCalledWith({ search: 'ana', page: 2 })
    );
  });

  it('setea error y vacia la lista cuando falla', async () => {
    mockGetClients.mockRejectedValue(new Error('DB caida'));

    const { result } = renderHook(() => useClients());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('DB caida');
    expect(result.current.clients).toEqual([]);
  });

  it('refetch vuelve a pedir los clientes', async () => {
    mockGetClients.mockResolvedValue({ data: [], total: 0, totalPages: 0 });

    const { result } = renderHook(() => useClients());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetClients).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());

    await waitFor(() => expect(mockGetClients).toHaveBeenCalledTimes(2));
  });
});

describe('hooks/use-clients - useClientDetail', () => {
  it('no pide nada cuando el id es null', () => {
    const { result } = renderHook(() => useClientDetail(null));

    expect(result.current.detail).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('carga el detalle cuando hay id', async () => {
    mockGetClient.mockResolvedValue({ id: 'c1', name: 'Ana', bookings: [] });

    const { result } = renderHook(() => useClientDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetClient).toHaveBeenCalledWith('c1');
    expect(result.current.detail).toEqual({ id: 'c1', name: 'Ana', bookings: [] });
  });

  it('setea error cuando falla la carga del detalle', async () => {
    mockGetClient.mockRejectedValue(new Error('No existe'));

    const { result } = renderHook(() => useClientDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('No existe');
  });
});
