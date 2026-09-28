/**
 * Pruebas unitarias para el hook `useAgency` (`src/hooks/use-agency.ts`):
 * carga en paralelo de stats/clientes, error, refetch y create/update/delete de
 * clientes (que recargan tras la operación). Se mockea el namespace `agencyApi`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  agencyApi: {
    getStats: vi.fn(),
    getClients: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
  },
}));

import { useAgency } from '@/hooks/use-agency';
import { agencyApi } from '@/lib/api/index';

const mockStats = agencyApi.getStats as ReturnType<typeof vi.fn>;
const mockClients = agencyApi.getClients as ReturnType<typeof vi.fn>;
const mockCreate = agencyApi.createClient as ReturnType<typeof vi.fn>;
const mockUpdate = agencyApi.updateClient as ReturnType<typeof vi.fn>;
const mockDelete = agencyApi.deleteClient as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-agency', () => {
  it('inicia en estado de carga', () => {
    mockStats.mockReturnValue(new Promise(() => {}));
    mockClients.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAgency());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.clients).toEqual([]);
  });

  it('carga stats y clientes desde la API', async () => {
    mockStats.mockResolvedValue({ totalClients: 3 });
    mockClients.mockResolvedValue([{ id: 'a1', name: 'Cliente X' }]);

    const { result } = renderHook(() => useAgency());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stats).toEqual({ totalClients: 3 });
    expect(result.current.clients).toEqual([{ id: 'a1', name: 'Cliente X' }]);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje', async () => {
    mockStats.mockRejectedValue(new Error('Sin datos'));
    mockClients.mockResolvedValue([]);

    const { result } = renderHook(() => useAgency());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin datos');
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockStats.mockRejectedValue('x');
    mockClients.mockResolvedValue([]);

    const { result } = renderHook(() => useAgency());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar datos de agencia');
  });

  it('createClient crea y recarga', async () => {
    mockStats.mockResolvedValue({});
    mockClients.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'a2' });

    const { result } = renderHook(() => useAgency());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockClients).toHaveBeenCalledTimes(1);

    const payload = { name: 'Nuevo', email: 'n@x.com' } as never;
    await act(async () => { await result.current.createClient(payload); });

    expect(mockCreate).toHaveBeenCalledWith(payload);
    await waitFor(() => expect(mockClients).toHaveBeenCalledTimes(2));
  });

  it('updateClient actualiza y recarga', async () => {
    mockStats.mockResolvedValue({});
    mockClients.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({ id: 'a1' });

    const { result } = renderHook(() => useAgency());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const payload = { name: 'Editado' } as never;
    await act(async () => { await result.current.updateClient('a1', payload); });

    expect(mockUpdate).toHaveBeenCalledWith('a1', payload);
    await waitFor(() => expect(mockClients).toHaveBeenCalledTimes(2));
  });

  it('deleteClient elimina y recarga', async () => {
    mockStats.mockResolvedValue({});
    mockClients.mockResolvedValue([]);
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAgency());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.deleteClient('a1'); });

    expect(mockDelete).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(mockClients).toHaveBeenCalledTimes(2));
  });
});
