import { SearchX, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Página no encontrada',
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-brand-500/10 mb-8">
          <SearchX className="h-10 w-10 text-brand-400" />
        </div>

        <h1 className="text-7xl font-bold text-white tracking-tight">404</h1>
        <h2 className="mt-3 text-xl font-semibold text-white">Página no encontrada</h2>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          La página que buscás no existe o fue movida a otra dirección.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className="btn-primary inline-flex items-center gap-2 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
          <Link href="/login" className="btn-secondary text-sm">
            Iniciar sesión
          </Link>
        </div>

        <p className="mt-10 text-xs text-slate-600">
          Si crees que esto es un error, contactanos.
        </p>
      </div>
    </div>
  );
}
