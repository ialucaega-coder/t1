'use client';

import { cn } from '@/lib/utils';

export interface ViewToggleOption {
  value: string;
  label: string;
}

export interface ViewToggleProps {
  options: ViewToggleOption[];
  activeValue: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ViewToggle({ options, activeValue, onChange, className }: ViewToggleProps) {
  return (
    <div className={cn('flex rounded-lg border border-slate-700 overflow-hidden', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            activeValue === option.value ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
