'use client';

import { useCallback, useEffect, useState } from 'react';
import * as aiApi from '@/lib/api/ai';
import type { SpendStatus } from '@/lib/api/ai';

export interface UseSpendCapResult {
  status: SpendStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Fija (o quita con null) el tope. Lanza el error real del server si falla. */
  save: (capUsd: number | null) => Promise<SpendStatus>;
}

export function useSpendCap(): UseSpendCapResult {
  const [status, setStatus] = useState<SpendStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const s = await aiApi.getSpendCap();
        if (!cancelled) setStatus(s);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el tope de gasto de IA');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const save = useCallback(async (capUsd: number | null) => {
    const next = await aiApi.setSpendCap(capUsd);
    setStatus(next);
    return next;
  }, []);

  return { status, isLoading, error, refetch, save };
}
