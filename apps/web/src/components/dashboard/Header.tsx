'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Search, Calendar, ShoppingBag, Megaphone, Check } from 'lucide-react';
import { PAGE_TITLES } from '@/config';
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

// ─── Header ──────────────────────────────────────────────────────────

export function Header() {
  const pathname = usePathname();
  const page = PAGE_TITLES[pathname] || { breadcrumb: 'PANEL', title: 'Local B' };
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

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
        <button className="rounded-lg p-2 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors">
          <Search className="h-4 w-4" />
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
    </header>
  );
}
