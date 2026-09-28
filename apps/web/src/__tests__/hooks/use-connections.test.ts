/**
 * Pruebas unitarias para el hook `useConnections` (`src/hooks/use-connections.ts`):
 * carga del estado de Telegram, error con fallback a desconectado,
 * refreshTelegramStatus, y connect/disconnect (que devuelven boolean y setean el
 * estado/error). Se mockea el namespace `connectionsApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  connectionsApi: {
    getTelegramStatus: vi.fn(),
    connectTelegram: vi.fn(),
    disconnectTelegram: vi.fn(),
  },
}));

import { useConnections } from '@/hooks/use-connections';
import { connectionsApi } from '@/lib/api/index';

const mockStatus = connectionsApi.getTelegramStatus as ReturnType<typeof vi.fn>;
const mockConnect = connectionsApi.connectTelegram as ReturnType<typeof vi.fn>;
const mockDisconnect = connectionsApi.disconnectTelegram as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-connections', () => {
  it('inicia en estado de carga', () => {
    mockStatus.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useConnections());

    expect(result.current.isTelegramLoading).toBe(true);
    expect(result.current.telegramStatus).toBeNull();
  });

  it('carga el estado de Telegram desde la API', async () => {
    mockStatus.mockResolvedValue({ connected: true, bot: { username: 'mi_bot', name: 'Mi Bot' } });

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));

    expect(result.current.telegramStatus).toEqual({
      connected: true,
      bot: { username: 'mi_bot', name: 'Mi Bot' },
    });
    expect(result.current.telegramError).toBeNull();
  });

  it('ante error de carga setea el mensaje y estado desconectado', async () => {
    mockStatus.mockRejectedValue(new Error('Sin conexión'));

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));

    expect(result.current.telegramError).toBe('Sin conexión');
    expect(result.current.telegramStatus).toEqual({ connected: false, bot: null });
  });

  it('connectTelegram conecta, setea el estado y devuelve true', async () => {
    mockStatus.mockResolvedValue({ connected: false, bot: null });
    mockConnect.mockResolvedValue({ bot: { username: 'nuevo_bot', name: 'Nuevo Bot' } });

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));

    let returned: boolean | undefined;
    await act(async () => { returned = await result.current.connectTelegram('token123'); });

    expect(mockConnect).toHaveBeenCalledWith('token123');
    expect(returned).toBe(true);
    expect(result.current.telegramStatus?.connected).toBe(true);
    expect(result.current.telegramStatus?.bot?.username).toBe('nuevo_bot');
  });

  it('connectTelegram devuelve false y setea error cuando falla', async () => {
    mockStatus.mockResolvedValue({ connected: false, bot: null });
    mockConnect.mockRejectedValue(new Error('Token inválido'));

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));

    let returned: boolean | undefined;
    await act(async () => { returned = await result.current.connectTelegram('bad'); });

    expect(returned).toBe(false);
    expect(result.current.telegramError).toBe('Token inválido');
  });

  it('disconnectTelegram desconecta, setea el estado y devuelve true', async () => {
    mockStatus.mockResolvedValue({ connected: true, bot: { username: 'x', name: 'X' } });
    mockDisconnect.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));

    let returned: boolean | undefined;
    await act(async () => { returned = await result.current.disconnectTelegram(); });

    expect(mockDisconnect).toHaveBeenCalled();
    expect(returned).toBe(true);
    expect(result.current.telegramStatus).toEqual({ connected: false, bot: null });
  });

  it('disconnectTelegram devuelve false y setea error cuando falla', async () => {
    mockStatus.mockResolvedValue({ connected: true, bot: { username: 'x', name: 'X' } });
    mockDisconnect.mockRejectedValue(new Error('Falló al desconectar'));

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));

    let returned: boolean | undefined;
    await act(async () => { returned = await result.current.disconnectTelegram(); });

    expect(returned).toBe(false);
    expect(result.current.telegramError).toBe('Falló al desconectar');
  });

  it('refreshTelegramStatus vuelve a pedir el estado', async () => {
    mockStatus.mockResolvedValue({ connected: false, bot: null });

    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.isTelegramLoading).toBe(false));
    expect(mockStatus).toHaveBeenCalledTimes(1);

    act(() => result.current.refreshTelegramStatus());
    await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(2));
  });
});
