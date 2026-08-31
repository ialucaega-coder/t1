'use client';

import { AlertTriangle } from 'lucide-react';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-sm">
        <AlertTriangle className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Error en el panel</h2>
        <p className="text-sm text-slate-400 mb-4">{error.message || 'Ocurrió un error inesperado.'}</p>
        <button onClick={reset} className="btn-primary text-sm">Reintentar</button>
      </div>
    </div>
  );
}
