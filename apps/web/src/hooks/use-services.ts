'use client';

import { useCallback, useEffect, useState } from 'react';
import { servicesApi } from '@/lib/api/index';
import type { Service } from '@/types';
import { MOCK_SERVICES } from '@/constants/services';

// Adapta los servicios mock (categoría como string) al shape real de la API
// (categoría como objeto { id, name }).
function adaptMockServices(): Service[] {
  return MOCK_SERVICES.map((s) => ({
    id: s.id,
    name: s.name,
    duration: s.duration,
    price: s.price,
    isActive: s.isActive,
    category: { id: s.category, name: s.category },
  }));
}

export interface UseServicesResult {
  services: Service[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createService: (data: Partial<Service>) => Promise<Service | null>;
  updateService: (id: string, data: Partial<Service>) => Promise<void>;
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
          setServices(adaptMockServices());
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

  const createService = useCallback(async (data: Partial<Service>) => {
    try {
      const created = await servicesApi.createService(data);
      setServices((prev) => [...prev, created]);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el servicio');
      return null;
    }
  }, []);

  const updateService = useCallback(async (id: string, data: Partial<Service>) => {
    try {
      const updated = await servicesApi.updateService(id, data);
      setServices((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar el servicio');
    }
  }, []);

  return { services, isLoading, error, refetch, createService, updateService };
}
