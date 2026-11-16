'use client';

import { useState, useCallback } from 'react';
import { Plus, Filter, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useBookings } from '@/hooks/use-bookings';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useAuth } from '@/lib/auth-context';
import * as bookingsApi from '@/lib/api/bookings';
import type { Booking as ApiBooking, CreateBookingData } from '@/types';
import { type Booking as LegacyBooking } from '@/constants/bookings';
import { BookingList } from '@/components/bookings/BookingList';
import { BookingCalendar } from '@/components/bookings/BookingCalendar';
import { BookingFormModal } from '@/components/bookings/BookingFormModal';
import { BookingDetailModal } from '@/components/bookings/BookingDetailModal';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { useToast } from '@/components/common/Toast';
import { usePageCounter, fmtCounter } from '@/stores/page-counter';

type ViewMode = 'calendar' | 'list';

function toLegacyBooking(booking: ApiBooking): LegacyBooking {
  return {
    id: booking.id,
    client: booking.client?.name ?? '',
    service: booking.service?.name ?? '',
    professional: booking.professional?.user?.name ?? '',
    time: booking.startTime,
    duration: booking.service?.duration ?? 0,
    status: booking.status as LegacyBooking['status'],
  };
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function ReservasPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<ViewMode>('list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTime, setCreateTime] = useState<string | undefined>(undefined);
  const [selectedBooking, setSelectedBooking] = useState<LegacyBooking | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Edición / reprogramación (mismo modal del alta) y confirmación de cancelar / eliminar.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'cancel' | 'delete'; id: string } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const { bookings, isLoading, error, refetch, createBooking, updateStatus, updateBooking, deleteBooking } = useBookings(selectedDate);
  const { toast } = useToast();
  const { business, user } = useAuth();
  const role = user?.role;
  const editingBooking = editingId ? bookings.find((b) => b.id === editingId) ?? null : null;
  const confirmBooking = confirm ? bookings.find((b) => b.id === confirm.id) ?? null : null;
  useSocket(business?.id ?? null);
  useSocketEvent('booking:created', () => refetch());
  useSocketEvent('booking:updated', () => refetch());

  // Contador vivo del header: reservas del día seleccionado.
  usePageCounter(isLoading ? null : fmtCounter(bookings.length, 'RESERVA', 'RESERVAS'));

  const legacyBookings = bookings.map(toLegacyBooking);
  const filteredBookings = statusFilter === 'all'
    ? legacyBookings
    : legacyBookings.filter((b) => b.status === statusFilter);

  // El modal muestra el error real del server (p. ej. horario ocupado) si esto rechaza.
  const handleCreate = useCallback(async (data: CreateBookingData) => {
    await createBooking(data);
    refetch();
    toast({ type: 'success', message: 'Reserva creada correctamente' });
  }, [createBooking, refetch, toast]);

  const handleEdit = useCallback(async (data: CreateBookingData) => {
    if (!editingId) return;
    await updateBooking(editingId, {
      date: data.date,
      startTime: data.startTime,
      serviceId: data.serviceId,
      professionalId: data.professionalId,
      notes: data.notes ?? '',
    });
    refetch();
    toast({ type: 'success', message: 'Reserva actualizada correctamente' });
  }, [editingId, updateBooking, refetch, toast]);

  const handleUpdateStatus = useCallback(async (id: string, status: string) => {
    try {
      await updateStatus(id, status);
      refetch();
      const label = status === 'CANCELLED' ? 'Reserva cancelada' : 'Reserva actualizada correctamente';
      toast({ type: 'success', message: label });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al actualizar reserva' });
    }
  }, [updateStatus, refetch, toast]);

  const handleConfirm = useCallback(async () => {
    if (!confirm) return;
    setConfirmLoading(true);
    try {
      if (confirm.kind === 'cancel') {
        await updateStatus(confirm.id, 'CANCELLED');
        toast({ type: 'success', message: 'Reserva cancelada' });
      } else {
        await deleteBooking(confirm.id);
        toast({ type: 'success', message: 'Reserva eliminada' });
      }
      refetch();
      setConfirm(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'No se pudo completar la acción' });
    } finally {
      setConfirmLoading(false);
    }
  }, [confirm, updateStatus, deleteBooking, refetch, toast]);

  const isToday = selectedDate === today;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'list' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Lista
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'calendar' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Calendario
            </button>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <button onClick={() => setSelectedDate(addDays(selectedDate, -1))} className="p-1 hover:text-white transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setSelectedDate(today)}
              className={`text-sm font-medium transition-colors ${isToday ? 'text-brand-400' : 'text-white hover:text-brand-400'}`}
            >
              {formatDate(selectedDate)}
            </button>
            <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="p-1 hover:text-white transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input text-xs py-1.5"
          >
            <option value="all">Todos</option>
            <option value="PENDING">Pendientes</option>
            <option value="CONFIRMED">Confirmadas</option>
            <option value="IN_PROGRESS">En curso</option>
            <option value="COMPLETED">Completadas</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
          <button
            onClick={() => bookingsApi.exportCsv().catch(console.error)}
            className="btn-secondary text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Exportar
          </button>
          <button onClick={() => { setCreateTime(undefined); setShowCreateModal(true); }} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Nueva reserva
          </button>
        </div>
      </div>

      {!isToday && (
        <button onClick={() => setSelectedDate(today)} className="text-xs text-brand-400 hover:underline">
          Volver a hoy
        </button>
      )}

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando reservas..." />
      ) : view === 'list' ? (
        <BookingList bookings={filteredBookings} onSelect={setSelectedBooking} />
      ) : (
        <BookingCalendar bookings={filteredBookings} onSlotClick={(time) => { setCreateTime(time); setShowCreateModal(true); }} />
      )}

      <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-700/50 pt-4">
        <span>{filteredBookings.length} reserva{filteredBookings.length !== 1 ? 's' : ''}</span>
        <span>{formatDate(selectedDate)}</span>
      </div>

      <BookingFormModal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setCreateTime(undefined); }}
        onSubmit={handleCreate}
        initialDate={selectedDate}
        initialTime={createTime}
      />

      <BookingDetailModal
        isOpen={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
        booking={selectedBooking}
        onUpdateStatus={handleUpdateStatus}
        onEdit={role === 'CLIENT' ? undefined : setEditingId}
        onRequestCancel={(id) => setConfirm({ kind: 'cancel', id })}
        onRequestDelete={role === 'ADMIN' ? (id) => setConfirm({ kind: 'delete', id }) : undefined}
      />

      <BookingFormModal
        isOpen={!!editingBooking}
        onClose={() => setEditingId(null)}
        onSubmit={handleEdit}
        booking={editingBooking}
      />

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleConfirm}
        loading={confirmLoading}
        variant="danger"
        title={confirm?.kind === 'delete' ? 'Eliminar reserva' : 'Cancelar reserva'}
        message={
          confirm?.kind === 'delete'
            ? `Vas a eliminar${confirmBooking ? ` la reserva de ${confirmBooking.client?.name ?? 'el cliente'}` : ' la reserva'} de forma definitiva. Esta acción no se puede deshacer.`
            : `Vas a cancelar${confirmBooking ? ` la reserva de ${confirmBooking.client?.name ?? 'el cliente'}` : ' la reserva'}. Se le avisa al cliente.`
        }
        confirmLabel={confirm?.kind === 'delete' ? 'Eliminar' : 'Cancelar reserva'}
        cancelLabel="Volver"
      />
    </div>
  );
}
