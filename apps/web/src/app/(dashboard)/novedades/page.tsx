'use client';

import { useState } from 'react';
import {
  Bell,
  Calendar,
  ShoppingBag,
  CheckCheck,
  Check,
  Megaphone,
  AlertCircle,
  BellOff,
} from 'lucide-react';
import { useNotifications } from '@/hooks/use-notifications';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/ui/EmptyState';
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

function getNotificationColor(type: string) {
  switch (type) {
    case 'BOOKING_CREATED':
      return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'BOOKING_CONFIRMED':
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'BOOKING_REMINDER':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    case 'BOOKING_CANCELLED':
      return 'text-red-400 bg-red-500/10 border-red-500/20';
    case 'ORDER_STATUS':
      return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
    case 'PROMOTION':
      return 'text-brand-400 bg-brand-500/10 border-brand-500/20';
    default:
      return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Ayer';
  if (diffD < 7) return `Hace ${diffD} días`;
  return new Date(dateStr).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// ─── Componente de notificación individual ───────────────────────────

function NotificationCard({
  notification,
  onMarkRead,
}: {
  notification: AppNotification;
  onMarkRead: (id: string) => void;
}) {
  const Icon = getNotificationIcon(notification.type);
  const colorClass = getNotificationColor(notification.type);

  return (
    <div
      className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
        notification.isRead
          ? 'border-slate-700/50 bg-surface/50 opacity-60'
          : 'border-slate-700/50 bg-surface-100'
      }`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${colorClass}`}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className={`text-sm font-semibold ${notification.isRead ? 'text-slate-400' : 'text-white'}`}>
            {notification.title}
          </h4>
          <span className="shrink-0 text-xs text-slate-500">{timeAgo(notification.createdAt)}</span>
        </div>
        <p className="text-sm text-slate-400 mt-0.5">{notification.body}</p>
      </div>

      {!notification.isRead && (
        <button
          onClick={() => onMarkRead(notification.id)}
          className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-surface-100 hover:text-white transition-colors"
          title="Marcar como leída"
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'unread';

// ─── Página principal ────────────────────────────────────────────────

export default function NovedadesPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const unreadOnly = activeTab === 'unread';
  const { notifications, unreadCount, isLoading, error, refetch, markRead, markAllRead } =
    useNotifications(unreadOnly);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Todas las notificaciones de tu negocio — reservas, pedidos, recordatorios y más.
      </p>

      {/* Toolbar: filtros + acciones */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg border border-slate-700/50 bg-surface p-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-surface-100 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Todas
          </button>
          <button
            onClick={() => setActiveTab('unread')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'unread'
                ? 'bg-surface-100 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            No leídas
            {unreadCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-400 px-1.5 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="btn-secondary text-xs"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como leídas
          </button>
        )}
      </div>

      {/* Error */}
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {/* Contenido */}
      {isLoading ? (
        <LoadingSpinner label="Cargando notificaciones..." />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={activeTab === 'unread' ? AlertCircle : BellOff}
          title={activeTab === 'unread' ? 'No tenés notificaciones sin leer' : 'Sin notificaciones'}
          description={
            activeTab === 'unread'
              ? '¡Estás al día! Todas las notificaciones fueron leídas.'
              : 'Las notificaciones de reservas, pedidos y recordatorios aparecerán acá.'
          }
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationCard key={n.id} notification={n} onMarkRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
}
