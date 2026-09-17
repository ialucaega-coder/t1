'use client';

import { useState } from 'react';
import { useSuperpowers } from '@/hooks/use-superpowers';
import { superpowersApi } from '@/lib/api/index';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

export default function SuperpoderesPage() {
  const { toast } = useToast();
  const { superpowers, isLoading, error, refetch } = useSuperpowers();
  const [toggling, setToggling] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Superpoderes</h1>
        <p className="text-sm text-slate-400 max-w-2xl mt-1">
          Los superpoderes son acciones que <strong className="text-white">tu bot hace solo</strong> —
          protege, detecta, avisa y actúa sin que vos intervengas. Activá o desactivá cada uno según lo que necesite tu negocio.
        </p>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando superpoderes..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {superpowers.map((power) => {
            const Icon = power.icon;
            const isToggling = toggling === power.name;
            return (
              <div
                key={power.name}
                className={`rounded-xl border p-5 flex flex-col transition-colors ${
                  power.isActive
                    ? 'border-sky-500/30 bg-sky-500/5'
                    : 'border-slate-700 bg-slate-800/50'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    power.isActive ? 'bg-sky-500/20' : 'bg-slate-700'
                  }`}>
                    <Icon className={`h-4.5 w-4.5 ${power.isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                  </div>
                  <button
                    onClick={() => handleToggle(power.name, power.isActive)}
                    disabled={isToggling}
                    className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                      power.isActive ? 'bg-sky-500' : 'bg-slate-600'
                    } ${isToggling ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
                        power.isActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <h3 className="font-semibold text-white mb-0.5">{power.name}</h3>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                  {power.subtitle}
                </p>
                <p className="text-sm text-slate-400 flex-1">{power.description}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
