'use client';

import { useCallback, useEffect, useState } from 'react';
import { settingsApi } from '@/lib/api/index';
import type { BusinessSettings } from '@/lib/api/settings';

export interface UseSettingsResult {
  /** `null` hasta que la configuración real se cargó (nunca datos inventados). */
  settings: BusinessSettings | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Guarda los cambios. Si falla, relanza el error para que la pantalla lo muestre. */
  updateSettings: (data: Partial<BusinessSettings>) => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      // El error previo se mantiene mientras se reintenta (se limpia recién al
      // cargar bien) para que la pantalla no parpadee ni se desmonte.
      try {
        const data = await settingsApi.getSettings();
        if (!cancelled) {
          setSettings(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar configuración');
          // No se vuelcan datos de relleno: si hay una carga previa se conserva,
          // y si no, `settings` queda en null para que la pantalla muestre el error.
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

  const updateSettingsFn = useCallback(async (data: Partial<BusinessSettings>) => {
    // El error se propaga a quien llama (la pantalla muestra el toast con el
    // mensaje real); `error` queda reservado para fallos de carga.
    const updated = await settingsApi.updateSettings(data);
    setSettings(updated);
  }, []);

  return { settings, isLoading, error, refetch, updateSettings: updateSettingsFn };
}
