'use client';

import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/50 mb-4">
        <Icon className="h-6 w-6 text-slate-500" />
      </div>
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      {description && <p className="mt-1 text-xs text-slate-500 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg bg-brand-400 px-4 py-2 text-xs font-medium text-white hover:bg-brand-500 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
