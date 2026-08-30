'use client';

import { useCallback, useEffect, useState } from 'react';
import { connectionsApi } from '@/lib/api/index';
import type { TelegramStatus } from '@/lib/api/connections';

// ────────────────────────────────────────────────────────────────
// Hook para gestionar conexiones de canales (Telegram, etc.)
// ────────────────────────────────────────────────────────────────

export interface UseConnectionsResult {
  // Telegram
  telegramStatus: TelegramStatus | null;
  isTelegramLoading: boolean;
  telegramError: string | null;
  connectTelegram: (botToken: string) => Promise<boolean>;
  disconnectTelegram: () => Promise<boolean>;
  refreshTelegramStatus: () => void;
}

export function useConnections(): UseConnectionsResult {
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [isTelegramLoading, setIsTelegramLoading] = useState(true);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Cargar estado de Telegram al montar
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsTelegramLoading(true);
      setTelegramError(null);
      try {
        const status = await connectionsApi.getTelegramStatus();
        if (!cancelled) setTelegramStatus(status);
      } catch (err) {
        if (!cancelled) {
          setTelegramError(err instanceof Error ? err.message : 'Error al cargar estado');
          setTelegramStatus({ connected: false, bot: null });
        }
      } finally {
        if (!cancelled) setIsTelegramLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refreshTelegramStatus = useCallback(() => setReloadToken((t) => t + 1), []);

  const connectTelegram = useCallback(async (botToken: string): Promise<boolean> => {
    setIsTelegramLoading(true);
    setTelegramError(null);
    try {
      const result = await connectionsApi.connectTelegram(botToken);
      setTelegramStatus({
        connected: true,
        bot: {
          username: result.bot.username,
          name: result.bot.name,
          connectedAt: new Date().toISOString(),
        },
      });
      return true;
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Error al conectar');
      return false;
    } finally {
      setIsTelegramLoading(false);
    }
  }, []);

  const disconnectTelegram = useCallback(async (): Promise<boolean> => {
    setIsTelegramLoading(true);
    setTelegramError(null);
    try {
      await connectionsApi.disconnectTelegram();
      setTelegramStatus({ connected: false, bot: null });
      return true;
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Error al desconectar');
      return false;
    } finally {
      setIsTelegramLoading(false);
    }
  }, []);

  return {
    telegramStatus,
    isTelegramLoading,
    telegramError,
    connectTelegram,
    disconnectTelegram,
    refreshTelegramStatus,
  };
}
