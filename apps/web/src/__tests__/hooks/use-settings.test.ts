/**
 * Pruebas unitarias para el hook `useSettings` (`src/hooks/use-settings.ts`):
 * carga, error de carga (sin volcar datos falsos), refetch y updateSettings
 * (éxito y propagación del error). Se mockea el namespace `settingsApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  settingsApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

import { useSettings } from '@/hooks/use-settings';
import { settingsApi } from '@/lib/api/index';

const mockGet = settingsApi.getSettings as ReturnType<typeof vi.fn>;
const mockUpdate = settingsApi.updateSettings as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-settings', () => {
  it('inicia en estado de carga sin datos inventados', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSettings());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.settings).toBeNull();
  });

  it('carga la configuración desde la API', async () => {
    const fake = { businessName: 'Peluquería Ana', slug: 'ana', currency: 'USD' };
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error de carga setea el mensaje y NO vuelca datos falsos', async () => {
    mockGet.mockRejectedValue(new Error('API caída'));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('API caída');
    expect(result.current.settings).toBeNull();
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue('boom');

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar configuración');
  });

  it('updateSettings reemplaza la configuración con la respuesta', async () => {
    mockGet.mockResolvedValue({ businessName: 'Original' });
    mockUpdate.mockResolvedValue({ businessName: 'Actualizado' });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({ businessName: 'Actualizado' });
    });

    expect(mockUpdate).toHaveBeenCalledWith({ businessName: 'Actualizado' });
    expect(result.current.settings?.businessName).toBe('Actualizado');
  });

  it('updateSettings relanza el error cuando falla y conserva los datos reales', async () => {
    mockGet.mockResolvedValue({ businessName: 'Original' });
    mockUpdate.mockRejectedValue(new Error('Sin permisos'));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.updateSettings({ businessName: 'x' });
      } catch (err) {
        thrown = err;
      }
    });

    expect((thrown as Error).message).toBe('Sin permisos');
    expect(result.current.settings?.businessName).toBe('Original');
  });

  it('al reintentar tras un error mantiene el error hasta cargar bien y limpia al éxito', async () => {
    mockGet.mockRejectedValueOnce(new Error('API caída'));
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.error).toBe('API caída'));

    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.error).toBe('API caída');

    await act(async () => resolve({ businessName: 'Real' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.settings?.businessName).toBe('Real');
  });

  it('refetch vuelve a pedir la configuración', async () => {
    mockGet.mockResolvedValue({ businessName: 'Original' });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
