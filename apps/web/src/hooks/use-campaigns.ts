'use client';

import { useCallback, useEffect, useState } from 'react';
import * as campaignsApi from '@/lib/api/campaigns';
import type { Campaign } from '@/lib/api/campaigns';

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await campaignsApi.list();
        if (!cancelled) setCampaigns(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar campañas');
          setCampaigns([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const createCampaign = useCallback(async (data: Parameters<typeof campaignsApi.create>[0]) => {
    await campaignsApi.create(data);
    refetch();
  }, [refetch]);

  const updateCampaign = useCallback(async (id: string, data: Parameters<typeof campaignsApi.update>[1]) => {
    await campaignsApi.update(id, data);
    refetch();
  }, [refetch]);

  const deleteCampaign = useCallback(async (id: string) => {
    await campaignsApi.remove(id);
    refetch();
  }, [refetch]);

  const sendCampaign = useCallback(async (id: string) => {
    await campaignsApi.send(id);
    refetch();
  }, [refetch]);

  return { campaigns, isLoading, error, refetch, createCampaign, updateCampaign, deleteCampaign, sendCampaign };
}
