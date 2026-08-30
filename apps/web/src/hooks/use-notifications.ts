'use client';

import { useCallback, useEffect, useState } from 'react';
import { notificationsApi } from '@/lib/api/index';
import type { AppNotification } from '@/types';

// No existe un archivo de constantes para notificaciones todavía; se define
// un fallback mínimo aquí mismo para cuando la API no está disponible.
const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'mock-1',
    type: 'BOOKING',
    channel: 'SYSTEM',
    title: 'Nueva reserva',
    body: 'María García reservó Corte + Peinado para hoy a las 09:00.',
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    type: 'ORDER',
    channel: 'SYSTEM',
    title: 'Pedido completado',
    body: 'Se registró una venta de $8.500.',
    isRead: true,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

export interface UseNotificationsResult {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(unreadOnly = false): UseNotificationsResult {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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
          setNotifications(MOCK_NOTIFICATIONS);
          setUnreadCount(MOCK_NOTIFICATIONS.filter((n) => !n.isRead).length);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
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
