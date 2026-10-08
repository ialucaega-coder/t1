'use client';

import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useSuperpowers } from '@/hooks/use-superpowers';
import { superpowersApi } from '@/lib/api/index';
import type { Superpower } from '@/constants/superpowers';
import type { SuperpowerParamValues } from '@/lib/api/superpowers';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { usePageCounter, fmtCounter } from '@/stores/page-counter';

export default function SuperpoderesPage() {
  const { toast } = useToast();
  const { superpowers, isLoading, error, refetch } = useSuperpowers();
  const [toggling, setToggling] = useState<string | null>(null);

  // Contador vivo del header: superpoderes activos (reacciona al togglear).
  usePageCounter(isLoading ? null : fmtCounter(superpowers.filter((p) => p.isActive).length, 'ACTIVO', 'ACTIVOS'));

  async function handleToggle(name: string, currentActive: boolean) {
    setToggling(name);
    try {
      await superpowersApi.updateSuperpower(name, { isActive: !currentActive });
      refetch();
      toast({ type: 'success', message: `Superpoder ${!currentActive ? 'activado' : 'desactivado'}` });
    } catch (err) {
      console.error('Error toggling superpower:', err);
      toast({ type: 'error', message: 'Error al cambiar estado del superpoder' });
    } finally {
      setToggling(null);
    }
  }

  async function handleSaveParams(name: string, params: SuperpowerParamValues) {
    await superpowersApi.updateSuperpower(name, { params });
    refetch();
    toast({ type: 'success', message: 'Configuración guardada' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Superpoderes</h1>
        <p className="text-sm text-slate-400 max-w-2xl mt-1">
          Los superpoderes son acciones que <strong className="text-white">tu bot hace solo</strong> —
          protege, detecta, avisa y actúa sin que vos intervengas. Activá o desactivá cada uno según lo que necesite tu negocio
          — y los que tienen <span className="text-sky-400">engranaje</span> podés ajustarlos a tu gusto.
        </p>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando superpoderes..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {superpowers.map((power) => (
            <SuperpowerCard
              key={power.name}
              power={power}
              toggling={toggling === power.name}
              onToggle={() => handleToggle(power.name, power.isActive)}
              onSaveParams={(params) => handleSaveParams(power.name, params)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuperpowerCard({
  power,
  toggling,
  onToggle,
  onSaveParams,
}: {
  power: Superpower;
  toggling: boolean;
  onToggle: () => void;
  onSaveParams: (params: SuperpowerParamValues) => Promise<void>;
}) {
  const Icon = power.icon;
  const specs = power.paramSpecs ?? [];
  const configurable = specs.length > 0;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SuperpowerParamValues>(() => ({ ...(power.params ?? {}) }));

  function setField(key: string, value: number | string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await onSaveParams(draft);
      setOpen(false);
    } catch {
      // El toast de error lo maneja el padre vía el flujo de updateSuperpower.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-xl border p-5 flex flex-col transition-colors ${
        power.isActive ? 'border-sky-500/30 bg-sky-500/5' : 'border-slate-700 bg-slate-800/50'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${power.isActive ? 'bg-sky-500/20' : 'bg-slate-700'}`}>
          <Icon className={`h-4.5 w-4.5 ${power.isActive ? 'text-sky-400' : 'text-slate-400'}`} />
        </div>
        <button
          onClick={onToggle}
          disabled={toggling}
          aria-label={power.isActive ? 'Desactivar' : 'Activar'}
          className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
            power.isActive ? 'bg-sky-500' : 'bg-slate-600'
          } ${toggling ? 'opacity-50' : ''}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
              power.isActive ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <h3 className="font-semibold text-white mb-0.5">{power.name}</h3>
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">{power.subtitle}</p>
      <p className="text-sm text-slate-400 flex-1">{power.description}</p>

      {configurable && (
        <div className="mt-4 border-t border-slate-700/50 pt-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {open ? 'Ocultar configuración' : 'Configurar'}
          </button>

          {open && (
            <div className="mt-3 space-y-3">
              {specs.map((spec) => {
                const value = draft[spec.key] ?? spec.default;
                return (
                  <div key={spec.key}>
                    <label className="block text-xs font-medium text-slate-300 mb-1">{spec.label}</label>
                    {spec.type === 'number' && (
                      <input
                        type="number"
                        min={spec.min}
                        max={spec.max}
                        value={value as number}
                        onChange={(e) => setField(spec.key, Number(e.target.value))}
                        className="input w-24"
                      />
                    )}
                    {spec.type === 'select' && (
                      <select
                        value={String(value)}
                        onChange={(e) => setField(spec.key, e.target.value)}
                        className="input w-full"
                      >
                        {(spec.options ?? []).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {spec.type === 'text' && (
                      <input
                        type="text"
                        value={String(value)}
                        maxLength={spec.maxLength}
                        placeholder={spec.placeholder}
                        onChange={(e) => setField(spec.key, e.target.value)}
                        className="input w-full"
                      />
                    )}
                    {spec.help && <p className="text-[11px] text-slate-500 mt-1">{spec.help}</p>}
                  </div>
                );
              })}
              <button onClick={save} disabled={saving} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
