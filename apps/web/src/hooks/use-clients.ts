'use client';

import { useCallback, useEffect, useState } from 'react';
import * as clientsApi from '@/lib/api/clients';
import type { Client, ClientDetail } from '@/types';

export function useClients(params?: { search?: string; page?: number }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await clientsApi.getClients({
          search: params?.search,
          page: params?.page,
        });
        if (!cancelled) {
          setClients(res.data);
          setTotal(res.total);
          setTotalPages(res.totalPages);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar clientes');
          setClients([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [params?.search, params?.page, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { clients, total, totalPages, isLoading, error, refetch };
}

export function useClientDetail(id: string | null) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!id) { setDetail(null); return; }
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await clientsApi.getClient(id!);
        if (!cancelled) setDetail(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar cliente');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, reloadToken]);

  const refetchDetail = useCallback(() => setReloadToken((t) => t + 1), []);

  return { detail, isLoading, error, refetchDetail };
}
