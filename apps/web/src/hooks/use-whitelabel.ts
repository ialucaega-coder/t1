'use client';

import { useCallback, useEffect, useState } from 'react';
import { whitelabelApi } from '@/lib/api/index';

const DEFAULTS = {
  name: 'Mi Agencia',
  primaryColor: '#38BDF8',
  secondaryColor: '',
  accentColor: '#38BDF8',
  customDomain: '',
  logo: '',
};

export interface UseWhitelabelResult {
  settings: typeof DEFAULTS;
  isLoading: boolean;
  error: string | null;
  saving: boolean;
  refetch: () => void;
  saveSettings: (data: any) => Promise<void>;
}

export function useWhitelabel(): UseWhitelabelResult {
  const [settings, setSettings] = useState(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await whitelabelApi.getSettings();
        if (!cancelled) {
          setSettings({
            name: result.name || DEFAULTS.name,
            primaryColor: result.primaryColor || DEFAULTS.primaryColor,
            secondaryColor: result.secondaryColor || DEFAULTS.secondaryColor,
            accentColor: result.accentColor || result.primaryColor || DEFAULTS.accentColor,
            customDomain: result.customDomain || DEFAULTS.customDomain,
            logo: result.logo || DEFAULTS.logo,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar configuración');
          setSettings(DEFAULTS);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const saveSettings = useCallback(async (data: any) => {
    setSaving(true);
    try {
      await whitelabelApi.updateSettings(data);
      refetch();
    } finally {
      setSaving(false);
    }
  }, [refetch]);

  return { settings, isLoading, error, saving, refetch, saveSettings };
}
