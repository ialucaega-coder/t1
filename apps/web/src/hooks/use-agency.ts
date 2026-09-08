'use client';

import { useCallback, useEffect, useState } from 'react';
import { agencyApi } from '@/lib/api/index';
import { AGENCY_STATS } from '@/constants/agency';
import type { AgencyClient } from '@/constants/agency';

export interface UseAgencyResult {
  stats: typeof AGENCY_STATS;
  clients: AgencyClient[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createClient: (data: any) => Promise<void>;
  updateClient: (id: string, data: any) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
}

export function useAgency(): UseAgencyResult {
  const [stats, setStats] = useState(AGENCY_STATS);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [statsRes, clientsRes] = await Promise.all([
          agencyApi.getStats(),
          agencyApi.getClients(),
        ]);
        if (!cancelled) {
          setStats(statsRes);
          setClients(clientsRes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar datos de agencia');
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

  const createClient = useCallback(async (data: any) => {
    await agencyApi.createClient(data);
    refetch();
  }, [refetch]);

  const updateClient = useCallback(async (id: string, data: any) => {
    await agencyApi.updateClient(id, data);
    refetch();
  }, [refetch]);

  const deleteClient = useCallback(async (id: string) => {
    await agencyApi.deleteClient(id);
    refetch();
  }, [refetch]);

  return { stats, clients, isLoading, error, refetch, createClient, updateClient, deleteClient };
}
