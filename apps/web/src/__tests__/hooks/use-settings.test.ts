/**
 * Pruebas unitarias para el hook `useSettings` (`src/hooks/use-settings.ts`):
 * carga, error con fallback a valores por defecto, refetch y updateSettings
 * (éxito y error). Se mockea el namespace `settingsApi` de `@/lib/api/index`.
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
  it('inicia en estado de carga con los valores por defecto', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSettings());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.settings.businessName).toBe('Mi Negocio');
  });

  it('carga la configuración desde la API', async () => {
    const fake = { businessName: 'Peluquería Ana', slug: 'ana', currency: 'USD' };
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y hace fallback a los valores por defecto', async () => {
    mockGet.mockRejectedValue(new Error('API caída'));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('API caída');
    expect(result.current.settings.businessName).toBe('Mi Negocio');
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
    expect(result.current.settings.businessName).toBe('Actualizado');
  });

  it('updateSettings setea error cuando falla', async () => {
    mockGet.mockResolvedValue({ businessName: 'Original' });
    mockUpdate.mockRejectedValue(new Error('Sin permisos'));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({ businessName: 'x' });
    });

    expect(result.current.error).toBe('Sin permisos');
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
