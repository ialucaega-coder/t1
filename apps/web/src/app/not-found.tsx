import { Flame } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-brand-500/10 mb-6">
          <Flame className="h-8 w-8 text-brand-400" />
        </div>
        <h1 className="text-6xl font-bold text-white mb-2">404</h1>
        <p className="text-sm text-slate-400 mb-6">La página que buscás no existe o fue movida.</p>
        <Link href="/" className="btn-primary text-sm inline-block">Volver al inicio</Link>
      </div>
    </div>
  );
}
