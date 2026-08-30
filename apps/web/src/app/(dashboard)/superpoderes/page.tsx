'use client';

import { useSuperpowers } from '@/hooks/use-superpowers';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

export default function SuperpoderesPage() {
  const { superpowers, isLoading, error, refetch } = useSuperpowers();

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Los superpoderes son acciones que <strong className="text-white">tu bot hace solo</strong> —
        protege, detecta, avisa y actúa sin que tú intervengas.
        Es distinto de los paneles de análisis, que son herramientas para leer datos.
      </p>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando superpoderes..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {superpowers.map((power) => {
            const Icon = power.icon;
            return (
              <div key={power.name} className="card-accent flex flex-col">
                <div className="flex items-start justify-between mb-3">
                  <Icon className="h-5 w-5 text-brand-400" />
                  {power.isActive ? (
                    <span className="badge-active">ACTIVO</span>
                  ) : (
                    <span className="badge-active">ACTIVO</span>
                  )}
                </div>
                <h3 className="font-semibold text-white mb-1">{power.name}</h3>
                <p className="mono-label mb-2">{power.subtitle}</p>
                <p className="text-sm text-slate-400 flex-1">{power.description}</p>
                <div className="flex gap-2 mt-4">
                  <button className="btn-secondary text-xs py-1.5 px-3">
                    Cómo funciona
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
