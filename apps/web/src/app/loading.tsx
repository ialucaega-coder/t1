import { Flame } from 'lucide-react';

export default function GlobalLoading() {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center">
      <div className="text-center">
        <Flame className="h-8 w-8 text-brand-400 animate-pulse mx-auto mb-3" />
        <p className="text-xs text-slate-500">Cargando...</p>
      </div>
    </div>
  );
}
