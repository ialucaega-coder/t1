import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  description: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ description, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <p className="text-sm text-slate-400 max-w-2xl">{description}</p>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}
