'use client';

import { useCallback, useEffect, useState } from 'react';
import { settingsApi } from '@/lib/api/index';
import type { BusinessSettings } from '@/lib/api/settings';
import { AI_PROVIDERS, THEME_OPTIONS } from '@/constants/settings';

// Valores por defecto cuando la API no está disponible.
const DEFAULT_SETTINGS: BusinessSettings = {
  businessName: 'Mi Negocio',
  slug: 'mi-negocio',
  phone: '+54 11 5555-0000',
  email: 'contacto@minegocio.com',
  address: 'Av. Corrientes 1234, CABA',
  timezone: 'America/Argentina/Buenos_Aires',
  currency: 'ARS',
  theme: 'onyx',
  accentColor: '#38BDF8',
  aiProviders: AI_PROVIDERS,
};

export interface UseSettingsResult {
  settings: BusinessSettings;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  updateSettings: (data: Partial<BusinessSettings>) => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<BusinessSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await settingsApi.getSettings();
        if (!cancelled) setSettings(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar configuración');
          // Fallback a datos mock cuando la API no está disponible.
          setSettings(DEFAULT_SETTINGS);
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
    try {
      const updated = await settingsApi.updateSettings(data);
      setSettings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar configuración');
    }
  }, []);

  return { settings, isLoading, error, refetch, updateSettings: updateSettingsFn };
}
