'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Flame } from 'lucide-react';
import { NAVIGATION } from '@/config';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col border-r border-slate-700/50 bg-surface">
      <div className="flex items-center gap-3 border-b border-slate-700/50 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-400">
          <Flame className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-white">Local B</h1>
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            CLOUD · COMPLETO
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAVIGATION.map((group) => (
          <div key={group.label}>
            <p className="section-label">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name + item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-surface-100 text-white border-l-2 border-brand-400 pl-[10px]'
                        : 'text-slate-400 hover:bg-surface-100 hover:text-white'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.badge === 'active' && (
                      <span className="badge-active text-[9px]">ACTIVO</span>
                    )}
                    {item.badge === 'new' && (
                      <span className="badge-new text-[9px]">NUEVO</span>
                    )}
                    {item.badge === 'prizes' && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">PREMIOS</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-400/20 text-brand-400 text-xs font-bold">
            LB
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-slate-300">Mi Negocio</p>
            <p className="truncate text-xs text-slate-500">admin@localb.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
