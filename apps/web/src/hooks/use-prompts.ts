'use client';

import { useCallback, useEffect, useState } from 'react';
import { promptsApi } from '@/lib/api/index';
import type { Prompt } from '@/constants/prompts';
import { MOCK_PROMPTS } from '@/constants/prompts';

export interface UsePromptsResult {
  prompts: Prompt[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePrompts(): UsePromptsResult {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await promptsApi.getPrompts();
        if (!cancelled) setPrompts(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar prompts');
          // Fallback a datos mock cuando la API no está disponible.
          setPrompts(MOCK_PROMPTS);
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

  return { prompts, isLoading, error, refetch };
}
