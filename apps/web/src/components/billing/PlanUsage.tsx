'use client';

import { useEffect, useState } from 'react';
import { Bot, Users, MessageSquare, AlertTriangle } from 'lucide-react';
import { getPlanLimits, type PlanLimits } from '@/lib/api/billing';

/** Devuelve el color de semáforo según el porcentaje de uso. */
function toneFor(used: number, limit: number): { bar: string; text: string } {
  const pct = limit > 0 ? used / limit : 0;
  if (pct >= 1) return { bar: 'bg-red-500', text: 'text-red-400' };
  if (pct >= 0.8) return { bar: 'bg-amber-500', text: 'text-amber-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
}

interface BarProps {
  icon: typeof Bot;
  label: string;
  used: number;
  limit: number;
  atLimit: boolean;
  hint?: string;
}

function UsageBar({ icon: Icon, label, used, limit, atLimit, hint }: BarProps) {
  const tone = toneFor(used, limit);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-slate-300">
          <Icon className="h-4 w-4 text-slate-400" />
          {label}
        </span>
        <span className={`font-medium tabular-nums ${tone.text}`}>
          {used.toLocaleString('es-AR')} / {limit.toLocaleString('es-AR')}
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-700"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={label}
      >
        <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      {atLimit && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
          <AlertTriangle className="h-3 w-3" />
          Alcanzaste el tope de tu plan. Mejorá el plan para seguir sumando.
        </p>
      )}
      {!atLimit && hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * Panel "Uso de tu plan": muestra bots, contactos y mensajes consumidos contra
 * el tope del plan, con semáforo de color. Consume GET /billing/limits.
 */
export function PlanUsage() {
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getPlanLimits()
      .then(setLimits)
      .catch(() => setFailed(true));
  }, []);

  // Falla en silencio: es informativo, no debe romper la página de facturación.
  if (failed || !limits) return null;

  const renewal = limits.messages.periodEnd
    ? `Renueva el ${new Date(limits.messages.periodEnd).toLocaleDateString('es-AR')}`
    : 'Ciclo de calendario mensual';

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
      <p className="text-xs uppercase tracking-wider text-slate-400">Uso de tu plan</p>
      <div className="mt-4 space-y-5">
        <UsageBar
          icon={MessageSquare}
          label="Mensajes del bot este mes"
          used={limits.messages.used}
          limit={limits.messages.limit}
          atLimit={limits.messages.overQuota}
          hint={renewal}
        />
        <UsageBar
          icon={Bot}
          label="Bots"
          used={limits.bots.used}
          limit={limits.bots.limit}
          atLimit={limits.bots.atLimit}
        />
        <UsageBar
          icon={Users}
          label="Contactos"
          used={limits.contacts.used}
          limit={limits.contacts.limit}
          atLimit={limits.contacts.atLimit}
        />
      </div>
    </div>
  );
}
