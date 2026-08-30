import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn('text-center py-16', className)}>
      <Icon className="h-12 w-12 text-slate-700 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-slate-400 mb-2">{title}</h3>
      {description && <p className="text-sm text-slate-500 mb-4">{description}</p>}
      {actionLabel && onAction && (
        <button className="btn-primary text-sm" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
