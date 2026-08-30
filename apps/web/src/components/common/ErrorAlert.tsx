import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ErrorAlertProps {
  /** Mensaje de error a mostrar */
  message: string;
  /** Callback opcional para reintentar la operación */
  onRetry?: () => void;
  className?: string;
}

// Componente de alerta de error, usado por los hooks de datos cuando la
// llamada a la API falla (aunque haya datos de respaldo mostrándose).
export function ErrorAlert({ message, onRetry, className }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1 text-xs font-medium text-red-300 hover:text-white transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </button>
      )}
    </div>
  );
}
