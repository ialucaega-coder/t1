'use client';

import { useEffect, useRef, useCallback } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose, loading]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      cancelRef.current?.focus();
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const confirmButtonClasses = {
    danger:
      'bg-red-600 hover:bg-red-500 focus:ring-red-500/40 text-white',
    warning:
      'bg-yellow-600 hover:bg-yellow-500 focus:ring-yellow-500/40 text-white',
    default:
      'bg-brand-600 hover:bg-brand-500 focus:ring-brand-500/40 text-white',
  }[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2
          id="confirm-dialog-title"
          className="text-sm font-semibold text-white mb-2"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-message"
          className="text-sm text-slate-400 mb-5"
        >
          {message}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 flex items-center gap-1.5 ${confirmButtonClasses}`}
          >
            {loading && (
              <svg
                className="h-3 w-3 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
