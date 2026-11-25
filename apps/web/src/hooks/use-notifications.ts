'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { notificationsApi } from '@/lib/api/index';
import type { AppNotification } from '@/types';

export interface UseNotificationsResult {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/**
 * Hook para consumir notificaciones desde la API.
 * Soporta filtrado por no leídas y polling automático cada 30s.
 */
export function useNotifications(unreadOnly = false): UseNotificationsResult {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await notificationsApi.getNotifications(unreadOnly);
        if (!cancelled) {
          setNotifications(data.data);
          setUnreadCount(data.unreadCount);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar notificaciones');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    function startPolling() {
      if (intervalRef.current) return;
      // Polling cada 30s para mantener el badge actualizado
      intervalRef.current = setInterval(() => {
        if (!cancelled) load();
      }, 30_000);
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // Pausa el polling cuando la pestaña no esta visible y lo reanuda
    // (con un fetch inmediato) al volver, para no pegar a la API en ocioso.
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        if (!cancelled) load();
        startPolling();
      }
    }

    load();

    // Solo arrancar el interval si la pestaña esta visible al montar
    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
    };
  }, [unreadOnly, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const markRead = useCallback(async (id: string) => {
    try {
      await notificationsApi.markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar como leída');
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar todas como leídas');
    }
  }, []);

  return { notifications, unreadCount, isLoading, error, refetch, markRead, markAllRead };
}
