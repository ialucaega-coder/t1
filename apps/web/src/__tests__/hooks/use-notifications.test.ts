/**
 * Pruebas unitarias para el hook `useNotifications` (`src/hooks/use-notifications.ts`):
 * carga con contador de no leidas, markRead / markAllRead y manejo de errores.
 *
 * El hook hace polling con setInterval cada 30s; se usan fake timers para
 * controlar el paso del tiempo y evitar llamadas fuera de control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  notificationsApi: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

import { useNotifications } from '@/hooks/use-notifications';
import { notificationsApi } from '@/lib/api/index';

const mockGet = notificationsApi.getNotifications as ReturnType<typeof vi.fn>;
const mockMarkRead = notificationsApi.markNotificationRead as ReturnType<typeof vi.fn>;
const mockMarkAllRead = notificationsApi.markAllRead as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-notifications', () => {
  it('carga notificaciones y el contador de no leidas', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'n1', isRead: false }, { id: 'n2', isRead: true }],
      unreadCount: 1,
    });

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('pasa el flag unreadOnly a la API', async () => {
    mockGet.mockResolvedValue({ data: [], unreadCount: 0 });

    renderHook(() => useNotifications(true));

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(true));
  });

  it('por defecto pide todas (unreadOnly = false)', async () => {
    mockGet.mockResolvedValue({ data: [], unreadCount: 0 });

    renderHook(() => useNotifications());

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(false));
  });

  it('setea error cuando la carga falla', async () => {
    mockGet.mockRejectedValue(new Error('Sin conexion'));

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin conexion');
  });

  it('markRead marca la notificacion como leida y decrementa el contador', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'n1', isRead: false }, { id: 'n2', isRead: false }],
      unreadCount: 2,
    });
    mockMarkRead.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(result.current.notifications.find((n) => n.id === 'n1')?.isRead).toBe(true);
    expect(result.current.notifications.find((n) => n.id === 'n2')?.isRead).toBe(false);
    expect(result.current.unreadCount).toBe(1);
  });

  it('markRead no deja el contador por debajo de cero', async () => {
    mockGet.mockResolvedValue({ data: [{ id: 'n1', isRead: false }], unreadCount: 0 });
    mockMarkRead.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it('markRead setea error cuando falla', async () => {
    mockGet.mockResolvedValue({ data: [{ id: 'n1', isRead: false }], unreadCount: 1 });
    mockMarkRead.mockRejectedValue(new Error('Fallo'));

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markRead('n1');
    });

    // Cuando el error es instancia de Error, el hook expone su mensaje
    expect(result.current.error).toBe('Fallo');
  });

  it('markRead usa mensaje generico cuando el error no es Error', async () => {
    mockGet.mockResolvedValue({ data: [{ id: 'n1', isRead: false }], unreadCount: 1 });
    mockMarkRead.mockRejectedValue('boom');

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markRead('n1');
    });

    expect(result.current.error).toBe('Error al marcar como leída');
  });

  it('markAllRead marca todas como leidas y pone el contador en cero', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'n1', isRead: false }, { id: 'n2', isRead: false }],
      unreadCount: 2,
    });
    mockMarkAllRead.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markAllRead();
    });

    expect(result.current.notifications.every((n) => n.isRead)).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it('pausa el polling cuando la pestaña se oculta y reanuda con fetch inmediato al volver', async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValue({ data: [], unreadCount: 0 });

    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    const { unmount } = renderHook(() => useNotifications());
    try {

      // fetch inicial al montar
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockGet).toHaveBeenCalledTimes(1);

      // mientras esta visible, el polling sigue cada 30s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(2);

      // al ocultar la pestaña, el polling se pausa (no hay nuevas llamadas)
      act(() => setVisibility('hidden'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(2);

      // al volver a visible, hace un fetch inmediato...
      act(() => setVisibility('visible'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockGet).toHaveBeenCalledTimes(3);

      // ...y reanuda el polling cada 30s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGet).toHaveBeenCalledTimes(4);
    } finally {
      unmount();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      vi.useRealTimers();
    }
  });
});
