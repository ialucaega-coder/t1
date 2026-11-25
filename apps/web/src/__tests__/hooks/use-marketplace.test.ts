/**
 * Pruebas unitarias para el hook `useMarketplace` (`src/hooks/use-marketplace.ts`):
 * carga, error, refetch e install/uninstall (que recargan la lista tras la
 * operación). Se mockea el namespace `marketplaceApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  marketplaceApi: {
    getItems: vi.fn(),
    installItem: vi.fn(),
    uninstallItem: vi.fn(),
  },
}));

import { useMarketplace } from '@/hooks/use-marketplace';
import { marketplaceApi } from '@/lib/api/index';

const mockGet = marketplaceApi.getItems as ReturnType<typeof vi.fn>;
const mockInstall = marketplaceApi.installItem as ReturnType<typeof vi.fn>;
const mockUninstall = marketplaceApi.uninstallItem as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-marketplace', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMarketplace());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('carga los items desde la API', async () => {
    const fake = [{ id: 'm1', name: 'Plugin A' }];
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => useMarketplace());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje', async () => {
    mockGet.mockRejectedValue(new Error('No disponible'));

    const { result } = renderHook(() => useMarketplace());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('No disponible');
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue(null);

    const { result } = renderHook(() => useMarketplace());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar marketplace');
  });

  it('installItem instala por id y recarga la lista', async () => {
    mockGet.mockResolvedValue([]);
    mockInstall.mockResolvedValue(undefined);

    const { result } = renderHook(() => useMarketplace());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.installItem('m1'); });

    expect(mockInstall).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('uninstallItem desinstala por id y recarga la lista', async () => {
    mockGet.mockResolvedValue([]);
    mockUninstall.mockResolvedValue(undefined);

    const { result } = renderHook(() => useMarketplace());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.uninstallItem('m1'); });

    expect(mockUninstall).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
