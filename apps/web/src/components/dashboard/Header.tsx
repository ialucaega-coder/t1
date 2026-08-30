'use client';

import { usePathname } from 'next/navigation';
import { Bell, Search } from 'lucide-react';
import { PAGE_TITLES } from '@/config';

export function Header() {
  const pathname = usePathname();
  const page = PAGE_TITLES[pathname] || { breadcrumb: 'PANEL', title: 'Local B' };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700/50 bg-surface/80 backdrop-blur-sm px-8 py-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">
          {page.breadcrumb}
        </p>
        <h2 className="text-xl font-bold text-white">{page.title}</h2>
      </div>

      <div className="flex items-center gap-3">
        {page.counter && (
          <div className="counter-badge">
            {page.counter}
          </div>
        )}
        <button className="rounded-lg p-2 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors">
          <Search className="h-4 w-4" />
        </button>
        <button className="relative rounded-lg p-2 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-400" />
        </button>
      </div>
    </header>
  );
}
