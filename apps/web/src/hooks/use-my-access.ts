'use client';

import { useEffect, useState } from 'react';
import { teamApi } from '@/lib/api/index';
import { useAuth } from '@/lib/auth-context';
import {
  resolveCapabilities,
  normalizePlanTier,
  PLAN_LABELS,
  type CapabilityKey,
  type PlanTier,
} from '@/constants/permissions';

export interface MyAccess {
  roleCaps: CapabilityKey[];
  planCaps: CapabilityKey[];
  planTier: PlanTier;
  planLabel: string;
}

// Cache a nivel de módulo: el acceso del usuario no cambia dentro de una sesión,
// así que lo traemos una sola vez y lo compartimos entre Sidebar y RouteGuard.
// Al cerrar sesión la app recarga (window.location), limpiando este cache.
let cache: MyAccess | null = null;

export function resetMyAccessCache() {
  cache = null;
}

export interface UseMyAccessResult {
  roleCaps: CapabilityKey[] | null;
  planCaps: CapabilityKey[] | null;
  planTier: PlanTier | null;
  planLabel: string | null;
  loading: boolean;
}

export function useMyAccess(): UseMyAccessResult {
  const { user } = useAuth();
  const [data, setData] = useState<MyAccess | null>(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (!user || cache) {
      setData(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    teamApi.getMyAccess()
      .then((res) => {
        const tier = normalizePlanTier(res.planTier);
        cache = {
          roleCaps: res.roleCapabilities as CapabilityKey[],
          planCaps: res.planCapabilities as CapabilityKey[],
          planTier: tier,
          planLabel: res.planLabel || PLAN_LABELS[tier],
        };
        if (!cancelled) { setData(cache); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  // Fallback: mientras carga (o si falla), usamos el default del rol del user.
  const roleCaps = data?.roleCaps ?? (user ? resolveCapabilities(user.role) : null);
  const planCaps = data?.planCaps ?? null;

  return {
    roleCaps,
    planCaps,
    planTier: data?.planTier ?? null,
    planLabel: data?.planLabel ?? null,
    loading,
  };
}
