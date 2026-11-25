'use client';

import { useCallback, useEffect, useState } from 'react';
import { agencyApi } from '@/lib/api/index';
import { AGENCY_STATS } from '@/constants/agency';
import type { AgencyClient } from '@/constants/agency';
import { AGENCY_PAGE_SIZE } from '@/lib/api/agency';
import type { CreateAgencyClientInput, UpdateAgencyClientInput } from '@/types/agency';

export interface UseAgencyResult {
  stats: typeof AGENCY_STATS;
  clients: AgencyClient[];
  /** Total de clientes que coinciden con la búsqueda (puede ser mayor que `clients.length`). */
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  loadingMore: boolean;
  error: string | null;
  refetch: () => void;
  loadMore: () => Promise<void>;
  createClient: (data: CreateAgencyClientInput) => Promise<void>;
  updateClient: (id: string, data: UpdateAgencyClientInput) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
}

/**
 * @param search búsqueda por nombre, resuelta en el server (el listado está paginado, así
 *               que filtrar solo lo cargado dejaba afuera a los clientes de otras páginas).
 */
export function useAgency(search = ''): UseAgencyResult {
  const [stats, setStats] = useState(AGENCY_STATS);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statsLoading, setStatsLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatsLoading(true);
      try {
        const statsRes = await agencyApi.getStats();
        if (!cancelled) setStats(statsRes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar datos de agencia');
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setClientsLoading(true);
      setError(null);
      try {
        const res = await agencyApi.getClients({ page: 1, pageSize: AGENCY_PAGE_SIZE, search: search || undefined });
        if (!cancelled) {
          setClients(res.data);
          setTotal(res.total);
          setPage(1);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar datos de agencia');
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, search]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await agencyApi.getClients({ page: page + 1, pageSize: AGENCY_PAGE_SIZE, search: search || undefined });
      // Sin duplicados por si entró un cliente nuevo entre páginas.
      setClients((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...res.data.filter((c) => !seen.has(c.id))];
      });
      setTotal(res.total);
      setPage((p) => p + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar más clientes');
    } finally {
      setLoadingMore(false);
    }
  }, [page, search]);

  const createClient = useCallback(async (data: CreateAgencyClientInput) => {
    await agencyApi.createClient(data);
    refetch();
  }, [refetch]);

  const updateClient = useCallback(async (id: string, data: UpdateAgencyClientInput) => {
    await agencyApi.updateClient(id, data);
    refetch();
  }, [refetch]);

  const deleteClient = useCallback(async (id: string) => {
    await agencyApi.deleteClient(id);
    refetch();
  }, [refetch]);

  // Spinner de página solo en la carga inicial / recarga completa (no al tipear en el buscador).
  const isLoading = statsLoading || (clientsLoading && clients.length === 0 && search === '');
  const hasMore = clients.length < total;

  return { stats, clients, total, hasMore, isLoading, loadingMore, error, refetch, loadMore, createClient, updateClient, deleteClient };
}
