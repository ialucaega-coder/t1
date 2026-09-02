'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Search, Calendar, ShoppingBag, Megaphone, Check, X } from 'lucide-react';
import { PAGE_TITLES } from '@/config';
import { NAVIGATION } from '@/config/navigation';
import { useNotifications } from '@/hooks/use-notifications';
import type { AppNotification } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────

function getNotificationIcon(type: string) {
  switch (type) {
    case 'BOOKING_CREATED':
    case 'BOOKING_CONFIRMED':
    case 'BOOKING_REMINDER':
    case 'BOOKING_CANCELLED':
      return Calendar;
    case 'ORDER_STATUS':
      return ShoppingBag;
    case 'PROMOTION':
      return Megaphone;
    default:
      return Bell;
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMin = Math.floor((now - then) / 60_000);
  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

// ─── Item de dropdown ────────────────────────────────────────────────

function DropdownItem({
  notification,
  onMarkRead,
}: {
  notification: AppNotification;
  onMarkRead: (id: string) => void;
}) {
  const Icon = getNotificationIcon(notification.type);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-100 ${
        notification.isRead ? 'opacity-50' : ''
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${notification.isRead ? 'text-slate-400' : 'text-white'}`}>
          {notification.title}
        </p>
        <p className="text-[11px] text-slate-500 truncate">{notification.body}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] text-slate-600">{timeAgo(notification.createdAt)}</span>
        {!notification.isRead && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(notification.id);
            }}
            className="rounded p-1 text-slate-600 hover:text-white transition-colors"
            title="Marcar como leída"
          >
            <Check className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Search Modal ───────────────────────────────────────────────────

function SearchModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [isOpen, onClose]);

  const allPages = NAVIGATION.flatMap((g) => g.items.map((item) => ({ ...item, group: g.label })));
  const filtered = query.trim()
    ? allPages.filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.group.toLowerCase().includes(query.toLowerCase())
      )
    : allPages.slice(0, 8);

  function navigate(href: string) {
    router.push(href);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-xl border border-slate-700/50 bg-surface shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-700/50 px-4 py-3">
          <Search className="h-4 w-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar páginas, funciones..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">No se encontraron resultados</p>
            </div>
          ) : (
            filtered.map((page) => {
              const Icon = page.icon;
              return (
                <button
                  key={page.href}
                  onClick={() => navigate(page.href)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-100"
                >
                  <Icon className="h-4 w-4 text-slate-500 shrink-0" />
                  <span className="flex-1 text-white">{page.name}</span>
                  <span className="text-[10px] text-slate-600 font-mono">{page.group}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────

export function Header() {
  const pathname = usePathname();
  const page = PAGE_TITLES[pathname] || { breadcrumb: 'PANEL', title: 'Local B' };
  const [isOpen, setIsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const latestNotifications = notifications.slice(0, 5);

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
        <button onClick={() => setSearchOpen(true)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors border border-slate-700/50">
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs text-slate-500 hidden sm:inline">Buscar...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-slate-700 px-1 py-0.5 text-[9px] text-slate-600">
            ⌘K
          </kbd>
        </button>

        {/* Notification bell con dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen((prev) => !prev)}
            className="relative rounded-lg p-2 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-400 px-1 text-[9px] font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {isOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-slate-700/50 bg-surface shadow-xl shadow-black/30">
              {/* Header del dropdown */}
              <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">Notificaciones</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllRead()}
                    className="text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    Marcar todas como leídas
                  </button>
                )}
              </div>

              {/* Lista */}
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-700/30">
                {latestNotifications.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">Sin notificaciones</p>
                  </div>
                ) : (
                  latestNotifications.map((n) => (
                    <DropdownItem key={n.id} notification={n} onMarkRead={markRead} />
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-700/50 px-4 py-2.5">
                <Link
                  href="/novedades"
                  onClick={() => setIsOpen(false)}
                  className="block text-center text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Ver todas las notificaciones
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
