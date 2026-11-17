'use client';

import { useCallback, useEffect, useState } from 'react';
import { teamApi } from '@/lib/api/index';
import {
  PERMISSION_CATALOG as FALLBACK_CATALOG,
  ROLE_DEFAULTS as FALLBACK_DEFAULTS,
  resolveCapabilities,
  effectiveCapabilities,
  capabilitiesForPlan,
  normalizePlanTier,
  PLAN_LABELS,
  type Capability,
  type CapabilityKey,
  type TeamRoleEnum,
  type PlanTier,
} from '@/constants/permissions';

export interface UsePermissionsResult {
  catalog: Capability[];
  roleDefaults: Record<TeamRoleEnum, string[]>;
  /** Overrides explícitos por miembro. Si un miembro no está, usa el default del rol. */
  overrides: Record<string, string[]>;
  /** Plan vigente del negocio y las capacidades que habilita. */
  planTier: PlanTier;
  planLabel: string;
  planCapabilities: CapabilityKey[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /** Capacidades concedidas al miembro (override o default del rol), sin filtrar por plan. */
  capabilitiesFor: (memberId: string, role: TeamRoleEnum) => string[];
  /** Capacidades que el miembro realmente puede usar: concedidas ∩ plan. */
  effectiveFor: (memberId: string, role: TeamRoleEnum) => CapabilityKey[];
  /** ¿La capacidad está incluida en el plan vigente? */
  isInPlan: (key: string) => boolean;
  /** ¿El miembro tiene un override explícito (distinto del default)? */
  hasOverride: (memberId: string) => boolean;
  save: (memberId: string, permissions: string[]) => Promise<void>;
  reset: (memberId: string) => Promise<void>;
}

export function usePermissions(): UsePermissionsResult {
  const [catalog, setCatalog] = useState<Capability[]>(FALLBACK_CATALOG);
  const [roleDefaults, setRoleDefaults] = useState<Record<TeamRoleEnum, string[]>>(FALLBACK_DEFAULTS);
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [planTier, setPlanTier] = useState<PlanTier>('FREE');
  const [planCapabilities, setPlanCapabilities] = useState<CapabilityKey[]>(capabilitiesForPlan('FREE'));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await teamApi.getPermissions();
        if (!cancelled) {
          if (Array.isArray(res.catalog) && res.catalog.length > 0) setCatalog(res.catalog);
          if (res.roleDefaults) setRoleDefaults(res.roleDefaults);
          setOverrides(res.overrides ?? {});
          const tier = normalizePlanTier(res.planTier);
          setPlanTier(tier);
          setPlanCapabilities(
            Array.isArray(res.planCapabilities) && res.planCapabilities.length > 0
              ? (res.planCapabilities as CapabilityKey[])
              : capabilitiesForPlan(tier),
          );
        }
      } catch (err) {
        // Si el backend falla, caemos al catálogo/-defaults locales (misma lista).
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar permisos');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const capabilitiesFor = useCallback(
    (memberId: string, role: TeamRoleEnum) => resolveCapabilities(role, overrides[memberId]),
    [overrides],
  );

  const effectiveFor = useCallback(
    (memberId: string, role: TeamRoleEnum) => effectiveCapabilities(role, overrides[memberId], planCapabilities),
    [overrides, planCapabilities],
  );

  const isInPlan = useCallback((key: string) => planCapabilities.includes(key as CapabilityKey), [planCapabilities]);

  const hasOverride = useCallback(
    (memberId: string) => Array.isArray(overrides[memberId]) && overrides[memberId].length > 0,
    [overrides],
  );

  const save = useCallback(async (memberId: string, permissions: string[]) => {
    const res = await teamApi.saveMemberPermissions(memberId, permissions);
    // El backend devuelve las capacidades efectivas; para ADMIN eso es "todas",
    // pero el override que guardamos localmente es lo que mandamos.
    setOverrides((prev) => {
      const next = { ...prev };
      if (permissions.length > 0) next[memberId] = permissions;
      else delete next[memberId];
      return next;
    });
    return void res;
  }, []);

  const reset = useCallback(async (memberId: string) => {
    await teamApi.resetMemberPermissions(memberId);
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
  }, []);

  return {
    catalog, roleDefaults, overrides,
    planTier, planLabel: PLAN_LABELS[planTier], planCapabilities,
    isLoading, error, refetch,
    capabilitiesFor, effectiveFor, isInPlan, hasOverride, save, reset,
  };
}
