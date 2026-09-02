'use client';

import { useState } from 'react';
import {
  Search, UserPlus, Users, ChevronLeft, ChevronRight,
  Calendar, ShoppingBag, Mail, Phone, Clock, Trash2,
  Edit3, X, User, Flame, Thermometer, Snowflake,
} from 'lucide-react';
import { useClients, useClientDetail } from '@/hooks/use-clients';
import * as clientsApi from '@/lib/api/clients';
import { ClientFormModal } from '@/components/clients/ClientFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

type Interest = 'hot' | 'warm' | 'cold';

function deriveInterest(bookings: number): Interest {
  if (bookings >= 10) return 'hot';
  if (bookings >= 5) return 'warm';
  return 'cold';
}

const INTEREST_CONFIG: Record<Interest, { label: string; class: string; icon: typeof Flame }> = {
  hot: { label: 'Caliente', class: 'bg-red-500/10 text-red-400 border-red-500/20', icon: Flame },
  warm: { label: 'Tibio', class: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Thermometer },
  cold: { label: 'Frío', class: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: Snowflake },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ClientesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { clients, total, totalPages, isLoading, error, refetch } = useClients({
    search: search || undefined,
    page,
  });
  const { detail, isLoading: detailLoading, refetchDetail } = useClientDetail(selectedId);

  async function handleCreate(data: { name: string; email: string; phone: string; notes: string }) {
    await clientsApi.createClient({ name: data.name, email: data.email, phone: data.phone || undefined });
    refetch();
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await clientsApi.deleteClient(id);
      if (selectedId === id) setSelectedId(null);
      refetch();
    } finally {
      setDeleting(null);
    }
  }

  if (isLoading && clients.length === 0) return <LoadingSpinner label="Cargando clientes..." />;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Clientes</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {total} cliente{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
          <UserPlus className="h-3.5 w-3.5" /> Agregar cliente
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Buscar por nombre, email o teléfono..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 pl-9 text-sm text-white placeholder:text-slate-600 focus:border-brand-400/50 focus:outline-none"
        />
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '30rem' }}>
        {/* Client list */}
        <div className="lg:col-span-1 space-y-1">
          {clients.length === 0 && (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                {search ? 'Sin resultados para la búsqueda.' : 'No hay clientes todavía.'}
              </p>
            </div>
          )}
          {clients.map((client) => {
            const bookings = client._count?.bookingsAsClient ?? 0;
            const interest = deriveInterest(bookings);
            const cfg = INTEREST_CONFIG[interest];
            const isSelected = selectedId === client.id;
            const lastVisit = client.bookingsAsClient?.[0]?.date;
            return (
              <button
                key={client.id}
                onClick={() => setSelectedId(client.id)}
                className={`w-full rounded-xl border p-3 text-left flex items-start gap-3 transition-all ${
                  isSelected
                    ? 'border-brand-400/50 bg-brand-400/5'
                    : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/60'
                }`}
              >
                <div className="h-9 w-9 rounded-full bg-brand-400/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-brand-400">
                    {client.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white truncate">{client.name}</p>
                    <span className={`badge border text-[9px] ${cfg.class}`}>{cfg.label}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{client.email}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                    <span>{bookings} reserva{bookings !== 1 ? 's' : ''}</span>
                    {lastVisit && (
                      <>
                        <span>·</span>
                        <span>Última: {timeAgo(lastVisit)}</span>
                      </>
                    )}
                    {(client._count?.orders ?? 0) > 0 && (
                      <>
                        <span>·</span>
                        <span>{client._count.orders} orden{client._count.orders !== 1 ? 'es' : ''}</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 px-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-xs py-1 disabled:opacity-30"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-slate-500">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary text-xs py-1 disabled:opacity-30"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Client detail */}
        <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-slate-800/30 flex flex-col" style={{ minHeight: '30rem' }}>
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <Users className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Seleccioná un cliente para ver su ficha</p>
                <p className="text-xs text-slate-600 mt-1">Historial de reservas, órdenes y actividad</p>
              </div>
            </div>
          )}

          {selectedId && detailLoading && (
            <div className="flex-1 flex items-center justify-center">
              <LoadingSpinner label="Cargando ficha..." />
            </div>
          )}

          {selectedId && detail && (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Client header */}
              <div className="p-4 border-b border-slate-700/50">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-brand-400/10 flex items-center justify-center">
                      <span className="text-lg font-bold text-brand-400">
                        {detail.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">{detail.name}</h2>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {detail.email}
                        </span>
                        {detail.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {detail.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleDelete(detail.id)}
                      disabled={deleting === detail.id}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Eliminar cliente"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-3 mt-4">
                  {[
                    { label: 'Reservas', value: detail._count?.bookingsAsClient ?? 0, icon: Calendar },
                    { label: 'Órdenes', value: detail._count?.orders ?? 0, icon: ShoppingBag },
                    {
                      label: 'Interés',
                      value: INTEREST_CONFIG[deriveInterest(detail._count?.bookingsAsClient ?? 0)].label,
                      icon: INTEREST_CONFIG[deriveInterest(detail._count?.bookingsAsClient ?? 0)].icon,
                    },
                    { label: 'Cliente desde', value: formatDate(detail.createdAt), icon: Clock },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-slate-700/30 p-2.5 text-center">
                      <stat.icon className="h-3.5 w-3.5 text-slate-500 mx-auto mb-1" />
                      <p className="text-sm font-semibold text-white">{stat.value}</p>
                      <p className="text-[10px] text-slate-500">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabs content */}
              <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                {/* Recent bookings */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Últimas reservas
                  </h3>
                  {detail.bookingsAsClient.length === 0 ? (
                    <p className="text-xs text-slate-600">Sin reservas registradas</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.bookingsAsClient.map((booking) => (
                        <div
                          key={booking.id}
                          className="flex items-center justify-between rounded-lg bg-slate-700/20 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-brand-400" />
                            <span className="text-sm text-white">{booking.service?.name || 'Servicio'}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span>{formatDate(booking.date)}</span>
                            <span>{booking.startTime}</span>
                            <span
                              className={`badge border text-[9px] ${
                                booking.status === 'CONFIRMED'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : booking.status === 'CANCELLED'
                                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                  : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                              }`}
                            >
                              {booking.status === 'CONFIRMED' ? 'Confirmada' : booking.status === 'CANCELLED' ? 'Cancelada' : booking.status === 'COMPLETED' ? 'Completada' : 'Pendiente'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent orders */}
                {detail.orders.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Últimas órdenes
                    </h3>
                    <div className="space-y-1.5">
                      {detail.orders.map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between rounded-lg bg-slate-700/20 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <ShoppingBag className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-sm text-white">
                              ${Number(order.totalPrice).toLocaleString('es-AR')}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span>{formatDate(order.createdAt)}</span>
                            <span
                              className={`badge border text-[9px] ${
                                order.status === 'COMPLETED'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                              }`}
                            >
                              {order.status === 'COMPLETED' ? 'Completada' : order.status === 'CANCELLED' ? 'Cancelada' : 'Pendiente'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent notifications */}
                {detail.notifications.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Actividad reciente
                    </h3>
                    <div className="space-y-1.5">
                      {detail.notifications.map((notif) => (
                        <div
                          key={notif.id}
                          className="flex items-start gap-2 rounded-lg bg-slate-700/20 px-3 py-2"
                        >
                          <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${notif.isRead ? 'bg-slate-600' : 'bg-brand-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white">{notif.title}</p>
                            <p className="text-[10px] text-slate-500 truncate">{notif.body}</p>
                          </div>
                          <span className="text-[10px] text-slate-600 shrink-0">
                            {timeAgo(notif.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ClientFormModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSave={handleCreate}
      />
    </div>
  );
}
