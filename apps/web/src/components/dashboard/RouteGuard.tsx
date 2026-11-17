'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { useMyAccess } from '@/hooks/use-my-access';
import { routeAccess, ownerCapability, minTierForCapability, PERMISSION_CATALOG, PLAN_LABELS } from '@/constants/permissions';

/**
 * Cierra el círculo de la sincronización: aunque alguien escriba la URL a mano,
 * una sección fuera de su plan muestra "mejorá tu plan" y una fuera de su rol
 * muestra "sin permiso", en vez de cargar la página igual.
 *
 * El gating de plan es una regla de producto (no de seguridad: el backend ya
 * scopea todo por negocio). Por eso mientras carga el acceso dejamos ver el
 * contenido y solo bloqueamos cuando confirmamos que no corresponde.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { roleCaps, planCaps, planLabel, loading } = useMyAccess();

  // Sin user todavía (carga de auth) o ruta sin capacidad asociada: dejamos pasar.
  if (!roleCaps) return <>{children}</>;

  const access = routeAccess(pathname, roleCaps, planCaps);
  if (access === 'open') return <>{children}</>;

  // Si el rol permite pero aún no cargó el plan, no bloqueamos de más.
  if (access === 'locked' && loading) return <>{children}</>;

  const cap = ownerCapability(pathname);
  const capLabel = PERMISSION_CATALOG.find((c) => c.key === cap)?.label ?? 'esta sección';

  if (access === 'locked') {
    const reqTier = cap ? minTierForCapability(cap) : null;
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md rounded-xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <Lock className="h-6 w-6 text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-white">{capLabel} no está en tu plan</h2>
          <p className="mt-2 text-sm text-slate-400">
            Tu negocio está en el plan <strong className="text-white">{planLabel}</strong>.
            {reqTier && <> Esta herramienta se habilita desde el plan <strong className="text-amber-400">{PLAN_LABELS[reqTier]}</strong>.</>}
          </p>
          <Link href="/facturacion" className="btn-primary mt-5 inline-flex text-xs">
            Ver planes y mejorar <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  // access === 'hidden': el rol del usuario no permite esta sección.
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-xl border border-slate-700/50 bg-surface-100 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-500/10">
          <ShieldAlert className="h-6 w-6 text-slate-400" />
        </div>
        <h2 className="text-lg font-bold text-white">No tenés permiso para {capLabel}</h2>
        <p className="mt-2 text-sm text-slate-400">
          Tu administrador no habilitó esta sección para tu usuario. Pedile acceso si la necesitás.
        </p>
        <Link href="/dashboard" className="btn-secondary mt-5 inline-flex text-xs">
          Volver al panel
        </Link>
      </div>
    </div>
  );
}
