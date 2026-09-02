'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Flame, Settings, LogOut, ChevronUp } from 'lucide-react';
import { NAVIGATION } from '@/config';
import { notificationsApi } from '@/lib/api/index';
import { useAuth } from '@/lib/auth-context';

export function Sidebar() {
  const pathname = usePathname();
  const { user, business, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [menuOpen]);

  useEffect(() => {
    notificationsApi.getUnreadCount().then((r) => setUnreadCount(r.unreadCount)).catch(() => {});
    const interval = setInterval(() => {
      notificationsApi.getUnreadCount().then((r) => setUnreadCount(r.unreadCount)).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

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
                    {item.href === '/novedades' && unreadCount > 0 && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-400 px-1.5 text-[9px] font-bold text-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative border-t border-slate-700/50 px-4 py-3" ref={menuRef}>
        {menuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-slate-700/50 bg-surface shadow-xl shadow-black/30 py-1">
            <Link href="/configuracion" onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-surface-100 hover:text-white transition-colors">
              <Settings className="h-4 w-4" /> Configuración
            </Link>
            <button onClick={logout}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        )}
        <button onClick={() => setMenuOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-lg p-1 hover:bg-surface-100 transition-colors">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-400/20 text-brand-400 text-xs font-bold shrink-0">
            {(business?.name || user?.name || 'LB').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="truncate text-sm font-medium text-slate-300">{business?.name || 'Mi Negocio'}</p>
            <p className="truncate text-xs text-slate-500">{user?.email || ''}</p>
          </div>
          <ChevronUp className={cn('h-4 w-4 text-slate-500 shrink-0 transition-transform', menuOpen && 'rotate-180')} />
        </button>
      </div>
    </aside>
  );
}
