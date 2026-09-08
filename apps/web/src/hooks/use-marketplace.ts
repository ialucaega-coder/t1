'use client';

import { useCallback, useEffect, useState } from 'react';
import { marketplaceApi } from '@/lib/api/index';
import type { MarketplaceItem } from '@/constants/marketplace';

export interface UseMarketplaceResult {
  items: MarketplaceItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  installItem: (id: string) => Promise<void>;
  uninstallItem: (id: string) => Promise<void>;
}

export function useMarketplace(): UseMarketplaceResult {
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await marketplaceApi.getItems();
        if (!cancelled) setItems(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar marketplace');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const installItem = useCallback(async (id: string) => {
    await marketplaceApi.installItem(id);
    refetch();
  }, [refetch]);

  const uninstallItem = useCallback(async (id: string) => {
    await marketplaceApi.uninstallItem(id);
    refetch();
  }, [refetch]);

  return { items, isLoading, error, refetch, installItem, uninstallItem };
}
