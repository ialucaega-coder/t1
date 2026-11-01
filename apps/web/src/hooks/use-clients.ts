'use client';

import { useCallback, useEffect, useState } from 'react';
import * as clientsApi from '@/lib/api/clients';
import type { ClientFunnel } from '@/lib/api/clients';
import type { Client, ClientDetail, ClientTag } from '@/types';

/** Embudo vacío por defecto (mientras carga o ante error). */
const EMPTY_FUNNEL: ClientFunnel = {
  counts: { NEW: 0, HOT: 0, PAYMENT: 0, CUSTOMER: 0 },
  total: 0,
  stages: ['NEW', 'HOT', 'PAYMENT', 'CUSTOMER'],
};

export function useClients(params?: { search?: string; tagId?: string; page?: number }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [tagCatalog, setTagCatalog] = useState<ClientTag[]>([]);
  const [funnel, setFunnel] = useState<ClientFunnel>(EMPTY_FUNNEL);
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
          tagId: params?.tagId,
          page: params?.page,
        });
        if (!cancelled) {
          setClients(res.data);
          setTotal(res.total);
          setTotalPages(res.totalPages);
          setTagCatalog(res.tagCatalog ?? []);
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
  }, [params?.search, params?.tagId, params?.page, reloadToken]);

  // El embudo cuenta sobre TODO el negocio (no depende de búsqueda/filtro/página),
  // así que se pide aparte y solo al montar o refrescar — no en cada tecla. Si
  // falla, no rompe el listado: cae a vacío.
  useEffect(() => {
    let cancelled = false;
    clientsApi
      .getClientFunnel()
      .catch(() => EMPTY_FUNNEL)
      .then((f) => {
        if (!cancelled) setFunnel(f);
      });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  return { clients, tagCatalog, funnel, total, totalPages, isLoading, error, refetch };
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
