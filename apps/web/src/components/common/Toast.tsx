'use client';

import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
  exiting: boolean;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const accentColors: Record<ToastType, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
};

const iconColors: Record<ToastType, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-blue-400',
  warning: 'text-amber-400',
};

function ToastMessage({ item, onRemove }: { item: ToastItem; onRemove: (id: string) => void }) {
  const Icon = icons[item.type];
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => onRemove(item.id), item.duration ?? 4000);
    return () => clearTimeout(timerRef.current);
  }, [item.id, item.duration, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-800 shadow-lg overflow-hidden transition-all duration-300 ${
        item.exiting
          ? 'translate-x-full opacity-0'
          : 'translate-x-0 opacity-100'
      }`}
    >
      <div className={`w-1 self-stretch shrink-0 ${accentColors[item.type]}`} />
      <div className="flex items-start gap-2 py-3 pr-3 flex-1 min-w-0">
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColors[item.type]}`} />
        <p className="text-sm text-slate-200 flex-1">{item.message}</p>
        <button
          onClick={() => onRemove(item.id)}
          className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...options, id, exiting: false }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-auto">
        {toasts.map((item) => (
          <ToastMessage key={item.id} item={item} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
