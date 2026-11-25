'use client';

import { useCallback, useEffect, useState } from 'react';
import { servicesApi } from '@/lib/api/index';
import type { Service } from '@/types';

interface MutationOptions {
  throwOnError?: boolean;
}

export interface UseServicesResult {
  services: Service[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Con `{ throwOnError: true }` el error se relanza (con el mensaje real del server)
   * en vez de guardarse en `error`: lo usan los formularios para mostrarlo en el modal.
   */
  createService: (data: Partial<Service>, opts?: MutationOptions) => Promise<Service | null>;
  updateService: (id: string, data: Partial<Service>, opts?: MutationOptions) => Promise<void>;
  deleteService: (id: string, opts?: MutationOptions) => Promise<void>;
}

export function useServices(): UseServicesResult {
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await servicesApi.getServices();
        if (!cancelled) setServices(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar servicios');
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

  const createService = useCallback(async (data: Partial<Service>, opts?: MutationOptions) => {
    try {
      const created = await servicesApi.createService(data);
      setServices((prev) => [...prev, created]);
      return created;
    } catch (err) {
      if (opts?.throwOnError) throw err;
      setError(err instanceof Error ? err.message : 'Error al crear el servicio');
      return null;
    }
  }, []);

  const updateService = useCallback(async (id: string, data: Partial<Service>, opts?: MutationOptions) => {
    try {
      const updated = await servicesApi.updateService(id, data);
      setServices((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      if (opts?.throwOnError) throw err;
      setError(err instanceof Error ? err.message : 'Error al actualizar el servicio');
    }
  }, []);

  const deleteService = useCallback(async (id: string, opts?: MutationOptions) => {
    try {
      await servicesApi.deleteService(id);
      setServices((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      if (opts?.throwOnError) throw err;
      setError(err instanceof Error ? err.message : 'Error al eliminar el servicio');
    }
  }, []);

  return { services, isLoading, error, refetch, createService, updateService, deleteService };
}
