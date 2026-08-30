'use client';

import { useCallback, useEffect, useState } from 'react';
import { posApi } from '@/lib/api/index';
import type { QuickItem } from '@/constants/pos';
import { QUICK_ITEMS } from '@/constants/pos';

export interface UsePosResult {
  items: QuickItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePos(): UsePosResult {
  const [items, setItems] = useState<QuickItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await posApi.getPosItems();
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar productos POS');
          // Fallback a datos mock cuando la API no está disponible.
          setItems(QUICK_ITEMS);
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

  return { items, isLoading, error, refetch };
}
