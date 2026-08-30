import { cn } from '@/lib/utils';

export type StatusBadgeVariant = 'active' | 'inactive' | 'premium' | 'new' | 'warning' | 'error' | 'info';

const variantClasses: Record<StatusBadgeVariant, string> = {
  active: 'badge-active',
  premium: 'badge-premium',
  new: 'badge-new',
  inactive: 'badge bg-slate-500/10 text-slate-400 border border-slate-500/20',
  warning: 'badge bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  error: 'badge bg-red-500/10 text-red-400 border border-red-500/20',
  info: 'badge bg-blue-500/10 text-blue-400 border border-blue-500/20',
};

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return <span className={cn(variantClasses[variant], className)}>{children}</span>;
}
