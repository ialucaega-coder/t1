'use client';

import { useCallback, useEffect, useState } from 'react';
import { clientsApi } from '@/lib/api/index';
import type { Client } from '@/types';
import { MOCK_CLIENTS } from '@/constants/clients';

// Adapta los clientes mock (lastVisit/totalBookings planos) al shape real
// de la API (createdAt, bookingsAsClient[], _count).
function adaptMockClients(): Client[] {
  return MOCK_CLIENTS.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    createdAt: c.lastVisit,
    bookingsAsClient: [{ date: c.lastVisit }],
    _count: { bookingsAsClient: c.totalBookings },
  }));
}

export interface UseClientsResult {
  clients: Client[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  searchClients: (search: string) => Promise<void>;
}

export function useClients(): UseClientsResult {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await clientsApi.getClients(search);
        if (!cancelled) setClients(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar clientes');
          setClients(adaptMockClients());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [search, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const searchClients = useCallback(async (query: string) => {
    setSearch(query || undefined);
  }, []);

  return { clients, isLoading, error, refetch, searchClients };
}
