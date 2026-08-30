import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoadingSpinnerProps {
  /** Texto opcional debajo del spinner */
  label?: string;
  /** Tamaño del ícono en píxeles */
  size?: number;
  className?: string;
}

// Spinner de carga simple, usado mientras los hooks de datos esperan la
// respuesta de la API.
export function LoadingSpinner({ label, size = 24, className }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-10 text-slate-400', className)}>
      <Loader2 className="animate-spin text-brand-500" style={{ width: size, height: size }} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
