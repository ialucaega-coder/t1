'use client';

import { Modal } from '@/components/ui/Modal';
import { User, Clock, Scissors, CalendarDays } from 'lucide-react';
import {
  type Booking,
  BOOKING_STATUS_COLORS as statusColors,
  BOOKING_STATUS_LABELS as statusLabels,
  type BookingStatus,
} from '@/constants/bookings';

interface BookingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking | null;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
}

export function BookingDetailModal({ isOpen, onClose, booking, onUpdateStatus }: BookingDetailModalProps) {
  if (!booking) return null;

  const handleAction = async (status: string) => {
    await onUpdateStatus(booking.id, status);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Detalle de reserva" size="sm">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className={`badge border ${statusColors[booking.status]}`}>
            {statusLabels[booking.status]}
          </span>
          <span className="text-xs text-slate-500 font-mono">#{booking.id}</span>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <User className="h-4 w-4 text-slate-500" />
            <div>
              <p className="text-sm font-medium text-white">{booking.client}</p>
              <p className="text-[10px] text-slate-500">Cliente</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Scissors className="h-4 w-4 text-slate-500" />
            <div>
              <p className="text-sm font-medium text-white">{booking.service}</p>
              <p className="text-[10px] text-slate-500">con {booking.professional}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-slate-500" />
            <div>
              <p className="text-sm font-medium text-white">{booking.time}</p>
              <p className="text-[10px] text-slate-500">{booking.duration} minutos</p>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-700/50 pt-4 flex flex-wrap gap-2">
          {booking.status === 'PENDING' && (
            <button onClick={() => handleAction('CONFIRMED')} className="btn-primary text-xs flex-1">
              Confirmar
            </button>
          )}
          {(booking.status === 'PENDING' || booking.status === 'CONFIRMED') && (
            <button onClick={() => handleAction('IN_PROGRESS')} className="btn-secondary text-xs flex-1">
              En curso
            </button>
          )}
          {booking.status === 'IN_PROGRESS' && (
            <button onClick={() => handleAction('COMPLETED')} className="btn-primary text-xs flex-1">
              Completar
            </button>
          )}
          {booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' && (
            <button onClick={() => handleAction('CANCELLED')} className="btn-secondary text-xs text-red-400 flex-1">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
