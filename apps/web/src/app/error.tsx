'use client';

import { Flame } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-red-500/10 mb-6">
          <Flame className="h-8 w-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Algo salió mal</h1>
        <p className="text-sm text-slate-400 mb-6">
          Ocurrió un error inesperado. Intentá de nuevo o volvé al inicio.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="btn-primary text-sm">Reintentar</button>
          <a href="/" className="btn-secondary text-sm">Ir al inicio</a>
        </div>
      </div>
    </div>
  );
}
