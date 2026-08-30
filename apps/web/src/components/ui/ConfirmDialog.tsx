'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirmar',
  variant = 'default',
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          {variant === 'danger' && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="btn-secondary text-xs" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className={cn(
              variant === 'danger' ? 'btn-primary text-xs bg-red-500 hover:bg-red-600' : 'btn-primary text-xs'
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
