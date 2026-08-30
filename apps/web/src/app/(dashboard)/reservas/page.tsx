'use client';

import { useState } from 'react';
import { Calendar, Clock, User, Plus, Filter, ChevronLeft, ChevronRight } from 'lucide-react';

const daysOfWeek = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const timeSlots = Array.from({ length: 12 }, (_, i) => `${(i + 8).toString().padStart(2, '0')}:00`);

const mockBookings = [
  { id: '1', client: 'María García', service: 'Corte + Peinado', professional: 'Ana López', time: '09:00', duration: 60, status: 'CONFIRMED' as const },
  { id: '2', client: 'Juan Pérez', service: 'Barba', professional: 'Carlos Ruiz', time: '10:00', duration: 30, status: 'PENDING' as const },
  { id: '3', client: 'Laura Méndez', service: 'Color completo', professional: 'Ana López', time: '11:00', duration: 120, status: 'CONFIRMED' as const },
  { id: '4', client: 'Roberto Silva', service: 'Corte caballero', professional: 'Carlos Ruiz', time: '14:00', duration: 45, status: 'IN_PROGRESS' as const },
];

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  CONFIRMED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  COMPLETED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  CANCELLED: 'bg-red-500/10 text-red-400 border-red-500/20',
  NO_SHOW: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No-show',
};

type ViewMode = 'calendar' | 'list';

export default function ReservasPage() {
  const [view, setView] = useState<ViewMode>('list');
  const today = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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
            <button className="p-1 hover:text-white transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-white">
              {today.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <button className="p-1 hover:text-white transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs">
            <Filter className="h-3.5 w-3.5" /> Filtrar
          </button>
          <button className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Nueva reserva
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <div className="space-y-2">
          {mockBookings.map((booking) => (
            <div key={booking.id} className="card-accent flex items-center gap-4 cursor-pointer">
              <div className="flex items-center justify-center w-16 text-center">
                <div>
                  <p className="text-lg font-bold text-white">{booking.time}</p>
                  <p className="text-[10px] text-slate-500 font-mono">{booking.duration} MIN</p>
                </div>
              </div>
              <div className="h-10 w-px bg-slate-700" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <User className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-sm font-medium text-white">{booking.client}</span>
                </div>
                <p className="text-xs text-slate-400">{booking.service} · con {booking.professional}</p>
              </div>
              <span className={`badge border ${statusColors[booking.status]}`}>
                {statusLabels[booking.status]}
              </span>
            </div>
          ))}

          {mockBookings.length === 0 && (
            <div className="text-center py-16">
              <Calendar className="h-12 w-12 text-slate-700 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-400 mb-2">Sin reservas para hoy</h3>
              <p className="text-sm text-slate-500 mb-4">Las reservas de tus clientes aparecerán aquí</p>
              <button className="btn-primary text-sm">
                <Plus className="h-4 w-4" /> Crear reserva manual
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[60px_1fr] divide-x divide-slate-800">
            <div />
            <div className="grid grid-cols-7 divide-x divide-slate-800">
              {daysOfWeek.map((day) => (
                <div key={day} className="px-2 py-3 text-center">
                  <p className="text-xs font-medium text-slate-400">{day}</p>
                </div>
              ))}
            </div>
          </div>
          {timeSlots.map((time) => (
            <div key={time} className="grid grid-cols-[60px_1fr] divide-x divide-slate-800 border-t border-slate-800">
              <div className="px-2 py-3 text-right">
                <span className="text-[10px] font-mono text-slate-500">{time}</span>
              </div>
              <div className="grid grid-cols-7 divide-x divide-slate-800">
                {daysOfWeek.map((day) => (
                  <div key={`${time}-${day}`} className="min-h-[48px] hover:bg-surface-100 transition-colors cursor-pointer" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
