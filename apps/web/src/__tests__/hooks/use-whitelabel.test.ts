/**
 * Pruebas unitarias para el hook `useWhitelabel` (`src/hooks/use-whitelabel.ts`):
 * carga con merge de defaults, error con fallback a defaults, refetch y
 * saveSettings (flag `saving` + recarga). Se mockea el namespace `whitelabelApi`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  whitelabelApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

import { useWhitelabel } from '@/hooks/use-whitelabel';
import { whitelabelApi } from '@/lib/api/index';

const mockGet = whitelabelApi.getSettings as ReturnType<typeof vi.fn>;
const mockUpdate = whitelabelApi.updateSettings as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-whitelabel', () => {
  it('inicia en estado de carga con los defaults', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWhitelabel());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.settings.name).toBe('Mi Agencia');
  });

  it('carga la configuración y completa los campos vacíos con defaults', async () => {
    mockGet.mockResolvedValue({
      name: 'Agencia Pro',
      primaryColor: '#FF0000',
      secondaryColor: '',
      accentColor: '',
      customDomain: '',
      logo: '',
    });

    const { result } = renderHook(() => useWhitelabel());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.name).toBe('Agencia Pro');
    expect(result.current.settings.primaryColor).toBe('#FF0000');
    // accentColor vacío hace fallback a primaryColor.
    expect(result.current.settings.accentColor).toBe('#FF0000');
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y hace fallback a defaults', async () => {
    mockGet.mockRejectedValue(new Error('No disponible'));

    const { result } = renderHook(() => useWhitelabel());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('No disponible');
    expect(result.current.settings.name).toBe('Mi Agencia');
  });

  it('saveSettings guarda, expone el flag saving y recarga', async () => {
    mockGet.mockResolvedValue({ name: 'Agencia', primaryColor: '#000' });
    mockUpdate.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWhitelabel());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);

    await act(async () => { await result.current.saveSettings({ name: 'Nuevo' }); });

    expect(mockUpdate).toHaveBeenCalledWith({ name: 'Nuevo' });
    expect(result.current.saving).toBe(false);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('refetch vuelve a pedir la configuración', async () => {
    mockGet.mockResolvedValue({ name: 'Agencia', primaryColor: '#000' });

    const { result } = renderHook(() => useWhitelabel());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
