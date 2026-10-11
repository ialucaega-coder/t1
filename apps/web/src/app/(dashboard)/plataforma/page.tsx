'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Building2,
  Users,
  Bot,
  Power,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  listBusinesses,
  setBusinessActive,
  setBusinessPlan,
  getBusinessFeatures,
  saveBusinessFeatures,
  type PlatformBusiness,
  type PlatformFeatureFlag,
  type PlanTier,
} from '@/lib/api/platform';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';

const PLAN_TIERS: PlanTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];
const PLAN_LABELS: Record<PlanTier, string> = {
  FREE: 'Gratis',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};
const PAGE_SIZE = 20;

export default function PlataformaPage() {
  const { toast } = useToast();
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 403 del backend: el usuario está logueado pero no está en la allowlist.
  const [denied, setDenied] = useState(false);
  // Acción en curso por negocio (deshabilita sus botones mientras guarda).
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal de feature flags.
  const [featuresFor, setFeaturesFor] = useState<PlatformBusiness | null>(null);
  const [featureCatalog, setFeatureCatalog] = useState<PlatformFeatureFlag[]>([]);
  const [featureDraft, setFeatureDraft] = useState<Record<string, boolean>>({});
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [featuresSaving, setFeaturesSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listBusinesses({ page, pageSize: PAGE_SIZE, search: search.trim() || undefined });
      setBusinesses(res.businesses);
      setTotal(res.total);
      setDenied(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      if (/platform admin/i.test(message)) {
        setDenied(true);
      } else {
        setError('No se pudieron cargar los negocios. Intentá de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Al buscar, volvemos a la primera página (evita quedar en una página vacía).
  useEffect(() => {
    setPage(1);
  }, [search]);

  const handleToggleActive = async (biz: PlatformBusiness) => {
    setBusyId(biz.id);
    try {
      const updated = await setBusinessActive(biz.id, !biz.isActive);
      setBusinesses((prev) => prev.map((b) => (b.id === biz.id ? { ...b, isActive: updated.isActive } : b)));
      toast({ type: 'success', message: updated.isActive ? `${biz.name} reactivado` : `${biz.name} suspendido` });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo cambiar el estado' });
    } finally {
      setBusyId(null);
    }
  };

  const handleChangePlan = async (biz: PlatformBusiness, tier: PlanTier) => {
    if (biz.planTier === tier) return;
    setBusyId(biz.id);
    try {
      const res = await setBusinessPlan(biz.id, tier);
      setBusinesses((prev) =>
        prev.map((b) =>
          b.id === biz.id
            ? { ...b, planTier: res.planTier, planName: res.planName, subscriptionStatus: res.status, cancelAtPeriodEnd: res.cancelAtPeriodEnd }
            : b,
        ),
      );
      toast({ type: 'success', message: `Plan de ${biz.name} cambiado a ${PLAN_LABELS[tier]}` });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo cambiar el plan' });
    } finally {
      setBusyId(null);
    }
  };

  const openFeatures = async (biz: PlatformBusiness) => {
    setFeaturesFor(biz);
    setFeaturesLoading(true);
    try {
      const res = await getBusinessFeatures(biz.id);
      setFeatureCatalog(res.catalog);
      setFeatureDraft(res.flags);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudieron cargar los flags' });
      setFeaturesFor(null);
    } finally {
      setFeaturesLoading(false);
    }
  };

  const handleSaveFeatures = async () => {
    if (!featuresFor) return;
    setFeaturesSaving(true);
    try {
      await saveBusinessFeatures(featuresFor.id, featureDraft);
      toast({ type: 'success', message: `Features de ${featuresFor.name} guardadas` });
      setFeaturesFor(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudieron guardar las features' });
    } finally {
      setFeaturesSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (denied) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md rounded-xl border border-slate-700/50 bg-surface-100 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-500/10">
            <ShieldAlert className="h-6 w-6 text-slate-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Acceso restringido</h2>
          <p className="mt-2 text-sm text-slate-400">
            El panel de plataforma es solo para administradores de la plataforma. Tu usuario no está habilitado.
          </p>
        </div>
      </div>
    );
  }

  if (loading && businesses.length === 0) {
    return <LoadingSpinner label="Cargando negocios..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-400/10">
          <ShieldCheck className="h-5 w-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Plataforma</h1>
          <p className="mt-1 text-sm text-slate-400">
            Panel del dueño: administrá todos los negocios, su plan, estado y features. Cross-tenant.
          </p>
        </div>
      </div>

      {error && <ErrorAlert message={error} onRetry={loadData} />}

      <div className="flex items-center justify-between gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar negocio..." className="max-w-xs" />
        <span className="text-xs text-slate-500">
          {total} {total === 1 ? 'negocio' : 'negocios'}
        </span>
      </div>

      {businesses.length === 0 ? (
        <EmptyState icon={Building2} title="Sin negocios" description="No hay negocios que coincidan con la búsqueda." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/50">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="px-4 py-3 font-medium">Negocio</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Uso</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((biz) => {
                  const busy = busyId === biz.id;
                  return (
                    <tr key={biz.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{biz.name}</p>
                        <p className="font-mono text-xs text-slate-500">/{biz.slug}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={biz.planTier ?? ''}
                          disabled={busy}
                          onChange={(e) => handleChangePlan(biz, e.target.value as PlanTier)}
                          className="input py-1.5 text-xs disabled:opacity-50"
                        >
                          {!biz.planTier && <option value="">Sin plan</option>}
                          {PLAN_TIERS.map((tier) => (
                            <option key={tier} value={tier}>
                              {PLAN_LABELS[tier]}
                            </option>
                          ))}
                        </select>
                        {biz.subscriptionStatus && (
                          <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                            {biz.subscriptionStatus}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {biz.isActive ? (
                          <StatusBadge variant="active">Activo</StatusBadge>
                        ) : (
                          <StatusBadge variant="error">Suspendido</StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span className="flex items-center gap-1" title="Usuarios">
                            <Users className="h-3.5 w-3.5" /> {biz.usersCount}
                          </span>
                          <span className="flex items-center gap-1" title="Bots">
                            <Bot className="h-3.5 w-3.5" /> {biz.botsCount}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openFeatures(biz)}
                            disabled={busy}
                            className="btn-secondary text-xs disabled:opacity-50"
                            title="Feature flags"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" /> Features
                          </button>
                          <button
                            onClick={() => handleToggleActive(biz)}
                            disabled={busy}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                              biz.isActive
                                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            {biz.isActive ? 'Suspender' : 'Reactivar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="btn-secondary text-xs disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <span className="text-xs text-slate-500">
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="btn-secondary text-xs disabled:opacity-40"
          >
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Modal
        isOpen={featuresFor !== null}
        onClose={() => !featuresSaving && setFeaturesFor(null)}
        title={featuresFor ? `Features de ${featuresFor.name}` : 'Features'}
        size="md"
      >
        {featuresLoading ? (
          <LoadingSpinner label="Cargando features..." />
        ) : (
          <>
            <p className="mb-4 text-xs text-slate-500">
              Flags por negocio que habilita el dueño, por encima de lo que concede el plan.
            </p>
            <div className="space-y-2">
              {featureCatalog.map((flag) => {
                const checked = featureDraft[flag.key] ?? false;
                return (
                  <label
                    key={flag.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      checked ? 'border-brand-400/40 bg-brand-400/5' : 'border-slate-700/50 hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setFeatureDraft((prev) => ({ ...prev, [flag.key]: !checked }))
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-400"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{flag.label}</p>
                      <p className="text-xs text-slate-500">{flag.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setFeaturesFor(null)}
                disabled={featuresSaving}
                className="btn-secondary text-xs disabled:opacity-50"
              >
                Cancelar
              </button>
              <button onClick={handleSaveFeatures} disabled={featuresSaving} className="btn-primary text-xs disabled:opacity-50">
                {featuresSaving ? 'Guardando...' : 'Guardar features'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
