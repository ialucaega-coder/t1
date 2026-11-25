'use client';

/**
 * Checklist de puesta en marcha (onboarding).
 * Ingeniería inversa de la "setup guide" de SalesMartly / onboarding de
 * respond.io: muestra el progreso real del negocio y guía a activar la cuenta.
 * Se calcula en el backend desde el estado real; acá solo se renderiza.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, ChevronRight, X, Rocket } from 'lucide-react';
import { onboardingApi } from '@/lib/api/index';
import type { Onboarding } from '@/lib/api/onboarding';

export function OnboardingChecklist() {
  const [data, setData] = useState<Onboarding | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onboardingApi
      .getOnboarding()
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { /* silencioso: el checklist es auxiliar, no rompe el dashboard */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  async function hide() {
    setData(null); // oculta optimista
    try { await onboardingApi.dismissOnboarding(true); } catch { /* no-op */ }
  }

  // No mostrar: aún cargando, error, ya descartado, o todo completo (ya activó).
  if (!loaded || !data || data.dismissed || data.percent === 100) return null;

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-brand-400/10 flex items-center justify-center shrink-0">
            <Rocket className="h-5 w-5 text-brand-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Puesta en marcha</h3>
            <p className="text-xs text-slate-500">
              {data.completed} de {data.total} pasos · activá tu cuenta para la beta
            </p>
          </div>
        </div>
        <button
          onClick={hide}
          className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-surface-100 hover:text-white transition-colors"
          aria-label="Ocultar checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Barra de progreso */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
          <span>Progreso</span>
          <span className="font-semibold text-brand-400">{data.percent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-700/50 overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-400 transition-all duration-500"
            style={{ width: `${data.percent}%` }}
          />
        </div>
      </div>

      {/* Pasos */}
      <ul className="space-y-1">
        {data.items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                item.done ? 'opacity-60' : 'hover:bg-surface-100'
              }`}
            >
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-slate-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.done ? 'text-slate-400 line-through' : 'text-white'}`}>
                  {item.label}
                </p>
                {!item.done && <p className="text-[11px] text-slate-500 truncate">{item.description}</p>}
              </div>
              {!item.done && <ChevronRight className="h-4 w-4 text-slate-600 shrink-0" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
