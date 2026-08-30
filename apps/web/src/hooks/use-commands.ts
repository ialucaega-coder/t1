'use client';

import { useCallback, useEffect, useState } from 'react';
import { commandsApi } from '@/lib/api/index';
import type { CommandGroup } from '@/constants/commands';
import { COMMANDS } from '@/constants/commands';

export interface UseCommandsResult {
  commands: CommandGroup[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCommands(): UseCommandsResult {
  const [commands, setCommands] = useState<CommandGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await commandsApi.getCommands();
        if (!cancelled) setCommands(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar comandos');
          // Fallback a datos mock cuando la API no está disponible.
          setCommands(COMMANDS);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { commands, isLoading, error, refetch };
}
