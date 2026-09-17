'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Package, Search, ChevronLeft, ChevronRight, Eye, X,
  Clock, DollarSign, User, ShoppingBag, ShoppingCart,
} from 'lucide-react';
import * as ordersApi from '@/lib/api/orders';
import type { Order } from '@/types';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';

const STATUS_CONFIG: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  PENDING: { label: 'Pendiente', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', next: 'CONFIRMED', nextLabel: 'Confirmar' },
  CONFIRMED: { label: 'Confirmada', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', next: 'PREPARING', nextLabel: 'Preparar' },
  PREPARING: { label: 'Preparando', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', next: 'READY', nextLabel: 'Lista' },
  READY: { label: 'Lista', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', next: 'DELIVERED', nextLabel: 'Entregar' },
  DELIVERED: { label: 'Entregada', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  CANCELLED: { label: 'Cancelada', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

export default function OrdenesPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const { toast } = useToast();

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: '20' };
      if (statusFilter) params.status = statusFilter;
      const res = await ordersApi.getOrders(params);
      setOrders(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages ?? 1);
    } catch {
      setError('Error al cargar órdenes');
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  async function handleAdvanceStatus(order: Order) {
    const cfg = STATUS_CONFIG[order.status];
    if (!cfg?.next) return;
    setUpdatingStatus(true);
    try {
      const updated = await ordersApi.updateOrderStatus(order.id, cfg.next);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
      if (selected?.id === order.id) setSelected(updated);
      toast({ type: 'success', message: 'Estado de orden actualizado correctamente' });
    } catch {
      setError('Error al actualizar estado');
      toast({ type: 'error', message: 'Error al actualizar estado de la orden' });
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleCancel(order: Order) {
    setUpdatingStatus(true);
    try {
      const updated = await ordersApi.updateOrderStatus(order.id, 'CANCELLED');
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
      if (selected?.id === order.id) setSelected(updated);
      toast({ type: 'success', message: 'Orden cancelada correctamente' });
    } catch {
      setError('Error al cancelar');
      toast({ type: 'error', message: 'Error al cancelar orden' });
    } finally {
      setUpdatingStatus(false);
    }
  }

  const pendingCount = orders.filter((o) => o.status === 'PENDING').length;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={() => { setError(''); fetchOrders(); }} />}

      <ConfirmDialog
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => { if (cancelTarget) { handleCancel(cancelTarget); } setCancelTarget(null); }}
        title="Cancelar orden"
        message="¿Cancelar esta orden?"
        confirmLabel="Cancelar orden"
        variant="warning"
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Órdenes</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {total} orden{total !== 1 ? 'es' : ''}
            {pendingCount > 0 && <span className="text-yellow-400 ml-2">{pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}</span>}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: '', label: 'Todas' },
          { value: 'PENDING', label: 'Pendientes' },
          { value: 'CONFIRMED', label: 'Confirmadas' },
          { value: 'PREPARING', label: 'Preparando' },
          { value: 'READY', label: 'Listas' },
          { value: 'DELIVERED', label: 'Entregadas' },
          { value: 'CANCELLED', label: 'Canceladas' },
        ].map((opt) => (
          <button key={opt.value}
            onClick={() => { setStatusFilter(opt.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === opt.value
                ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
            }`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '24rem' }}>
        {/* Orders list */}
        <div className="lg:col-span-2 space-y-2">
          {isLoading ? (
            <LoadingSpinner label="Cargando órdenes..." />
          ) : orders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No hay órdenes" description={statusFilter ? 'No hay órdenes con ese estado' : undefined} />
          ) : (
            <>
              {orders.map((order) => {
                const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
                const isSelected = selected?.id === order.id;
                return (
                  <button key={order.id} onClick={() => setSelected(order)}
                    className={`w-full rounded-xl border p-3 text-left flex items-center gap-3 transition-all ${
                      isSelected
                        ? 'border-brand-400/50 bg-brand-400/5'
                        : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600'
                    }`}>
                    <div className="h-10 w-10 rounded-lg bg-slate-700/50 flex items-center justify-center shrink-0">
                      <Package className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-white truncate">
                          ORD-{order.id.slice(-8).toUpperCase()}
                        </p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] border shrink-0 ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                        <span className="flex items-center gap-0.5">
                          <User className="h-2.5 w-2.5" /> {order.client?.name || 'Sin cliente'}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <ShoppingBag className="h-2.5 w-2.5" /> {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" /> {new Date(order.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="font-mono font-medium text-white">
                          ${Number(order.totalPrice).toLocaleString('es-AR')}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs text-slate-500">{page} / {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div>
                <Eye className="h-10 w-10 text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Seleccioná una orden para ver el detalle</p>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">ORD-{selected.id.slice(-8).toUpperCase()}</h3>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] border ${(STATUS_CONFIG[selected.status] || STATUS_CONFIG.PENDING).color}`}>
                  {(STATUS_CONFIG[selected.status] || STATUS_CONFIG.PENDING).label}
                </span>
                <span className="text-[10px] text-slate-500">
                  {new Date(selected.createdAt).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="rounded-lg bg-slate-900/50 p-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Cliente</p>
                <p className="text-sm text-white">{selected.client?.name || 'Sin cliente'}</p>
              </div>

              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Items</p>
                <div className="space-y-1.5">
                  {selected.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2">
                      <div>
                        <p className="text-xs text-white">{item.product?.name || 'Producto'}</p>
                        <p className="text-[10px] text-slate-500">{item.quantity} x ${Number(item.price).toLocaleString('es-AR')}</p>
                      </div>
                      <p className="text-xs font-mono text-white">${(item.quantity * Number(item.price)).toLocaleString('es-AR')}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                <span className="text-sm text-slate-400">Total</span>
                <span className="text-lg font-bold font-mono text-white">${Number(selected.totalPrice).toLocaleString('es-AR')}</span>
              </div>

              {selected.notes && (
                <div className="rounded-lg bg-slate-900/50 p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Notas</p>
                  <p className="text-xs text-slate-300">{selected.notes}</p>
                </div>
              )}

              {/* Actions */}
              {selected.status !== 'DELIVERED' && selected.status !== 'CANCELLED' && (
                <div className="flex items-center gap-2 pt-2">
                  {STATUS_CONFIG[selected.status]?.next && (
                    <button onClick={() => handleAdvanceStatus(selected)} disabled={updatingStatus}
                      className="flex-1 btn-primary text-xs justify-center disabled:opacity-50">
                      {updatingStatus ? '...' : STATUS_CONFIG[selected.status].nextLabel}
                    </button>
                  )}
                  <button onClick={() => setCancelTarget(selected)} disabled={updatingStatus}
                    className="px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors disabled:opacity-50">
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
