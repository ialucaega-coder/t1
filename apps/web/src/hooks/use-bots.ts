'use client';

import { useCallback, useEffect, useState } from 'react';
import * as botsApi from '@/lib/api/bots';
import type { Bot } from '@/lib/api/bots';

export function useBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await botsApi.list();
        if (!cancelled) setBots(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar bots');
          setBots([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const createBot = useCallback(async (data: Parameters<typeof botsApi.create>[0]) => {
    await botsApi.create(data);
    refetch();
  }, [refetch]);

  const updateBot = useCallback(async (id: string, data: Parameters<typeof botsApi.update>[1]) => {
    await botsApi.update(id, data);
    refetch();
  }, [refetch]);

  const deleteBot = useCallback(async (id: string) => {
    await botsApi.remove(id);
    refetch();
  }, [refetch]);

  return { bots, isLoading, error, refetch, createBot, updateBot, deleteBot };
}
