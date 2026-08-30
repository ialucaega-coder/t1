'use client';

import { useCallback, useEffect, useState } from 'react';
import { superpowersApi } from '@/lib/api/index';
import type { Superpower } from '@/constants/superpowers';
import { SUPERPOWERS } from '@/constants/superpowers';

export interface UseSuperpowersResult {
  superpowers: Superpower[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSuperpowers(): UseSuperpowersResult {
  const [superpowers, setSuperpowers] = useState<Superpower[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await superpowersApi.getSuperpowers();
        if (!cancelled) {
          // La API devuelve iconName como string; mapeamos al componente
          // Lucide correspondiente usando el catálogo local de SUPERPOWERS.
          const mapped: Superpower[] = data.map((s) => {
            const match = SUPERPOWERS.find((sp) => sp.name === s.name);
            return {
              name: s.name,
              subtitle: s.subtitle,
              description: s.description,
              icon: match?.icon ?? SUPERPOWERS[0].icon,
              isActive: s.isActive,
            };
          });
          setSuperpowers(mapped);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar superpoderes');
          // Fallback a datos mock cuando la API no está disponible.
          setSuperpowers(SUPERPOWERS);
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

  return { superpowers, isLoading, error, refetch };
}
