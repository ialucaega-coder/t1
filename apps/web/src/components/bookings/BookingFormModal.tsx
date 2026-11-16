'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { getServices } from '@/lib/api/services';
import { getProfessionals, getAvailability } from '@/lib/api/professionals';
import { fallbackTimeSlots, slotsForDuration, slotsOccupiedBy } from './slots';
import type { Booking, CreateBookingData, Service, Professional } from '@/types';

interface BookingFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Alta (sin `booking`) o guardado de la edición (con `booking`). Debe rechazar con el error real. */
  onSubmit: (data: CreateBookingData) => Promise<void>;
  initialDate?: string;
  initialTime?: string;
  /** Si viene, el modal funciona en modo edición / reprogramación de esa reserva. */
  booking?: Booking | null;
}

const FALLBACK_SLOTS = fallbackTimeSlots();

interface AvailabilityState {
  /** Clave `${professionalId}|${date}` para descartar respuestas viejas. */
  key: string;
  status: 'ok' | 'closed' | 'error';
  slots: string[];
}

const dayOf = (iso: string) => iso.slice(0, 10);

export function BookingFormModal({ isOpen, onClose, onSubmit, initialDate, initialTime, booking }: BookingFormModalProps) {
  const isEdit = !!booking;
  const today = new Date().toISOString().slice(0, 10);
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState(initialDate ?? today);
  const [startTime, setStartTime] = useState(initialTime ?? '');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<AvailabilityState | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getServices(), getProfessionals()])
      .then(([svc, prof]) => {
        if (cancelled) return;
        setServices(svc);
        setProfessionals(prof);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  // El modal queda montado entre aperturas: useState solo toma los valores iniciales
  // la primera vez. Al abrir, volvemos a tomarlos: los de la reserva (edición) o la
  // fecha y la hora que llegan por props (p. ej. la franja tocada en el calendario).
  useEffect(() => {
    if (!isOpen) return;
    if (booking) {
      setServiceId(booking.service?.id ?? '');
      setProfessionalId(booking.professional?.id ?? '');
      setDate(dayOf(booking.date));
      setStartTime(booking.startTime);
      setNotes(booking.notes ?? '');
    } else {
      setServiceId('');
      setProfessionalId('');
      setDate(initialDate ?? new Date().toISOString().slice(0, 10));
      setStartTime(initialTime ?? '');
      setNotes('');
    }
    setAvailability(null);
    setError('');
    // Depende del id (no del objeto): un refetch por socket no debe pisar lo que se está tipeando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, booking?.id, initialDate, initialTime]);

  // Horario de atención del profesional para el día elegido (ya sin los turnos ocupados).
  useEffect(() => {
    if (!isOpen || !professionalId || !date) return;
    const key = `${professionalId}|${date}`;
    let cancelled = false;
    getAvailability(professionalId, date)
      .then((res) => {
        if (cancelled) return;
        setAvailability({ key, status: res.available ? 'ok' : 'closed', slots: res.slots ?? [] });
      })
      .catch(() => {
        if (!cancelled) setAvailability({ key, status: 'error', slots: [] });
      });
    return () => { cancelled = true; };
  }, [isOpen, professionalId, date]);

  const selectedService = services.find((s) => s.id === serviceId);

  // Franjas: del horario del profesional y la duración del servicio; si no hay
  // horario cargado (o falló la carga) se mantienen las de 30 min.
  const currentAvailability = availability && availability.key === `${professionalId}|${date}` ? availability : null;
  let timeOptions = FALLBACK_SLOTS;
  let slotsHint = '';
  if (currentAvailability?.status === 'ok') {
    let free = currentAvailability.slots;
    // Al editar, el propio turno no cuenta como ocupado (si sigue en el mismo profesional y día).
    if (booking && professionalId === booking.professional?.id && date === dayOf(booking.date)) {
      free = [...new Set([...free, ...slotsOccupiedBy(booking.startTime, booking.endTime)])];
    }
    timeOptions = slotsForDuration(free, selectedService?.duration ?? 30);
    if (timeOptions.length === 0) slotsHint = 'No quedan franjas libres para este servicio ese día.';
  } else if (currentAvailability?.status === 'closed') {
    slotsHint = 'El profesional no tiene horario de atención ese día. Se muestran franjas de 30 min.';
  } else if (currentAvailability?.status === 'error') {
    slotsHint = 'No se pudo cargar el horario del profesional. Se muestran franjas de 30 min.';
  }
  // La hora actual (p. ej. la del turno que se edita) siempre tiene que poder mostrarse.
  const extraTime = startTime && !timeOptions.includes(startTime) ? startTime : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceId || !professionalId || !date || !startTime) {
      setError('Completa todos los campos obligatorios');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSubmit(
        isEdit
          ? { serviceId, professionalId, date, startTime, notes }
          : { serviceId, professionalId, date, startTime, notes: notes || undefined, source: 'WALK_IN' }
      );
      onClose();
    } catch (err) {
      // El mensaje real del server (p. ej. "Ese horario ya está reservado para el profesional.").
      setError(err instanceof Error && err.message ? err.message : isEdit ? 'Error al guardar los cambios' : 'Error al crear la reserva');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar reserva' : 'Nueva reserva'} size="md">
      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Cargando datos...</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Servicio *</label>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input" required>
              <option value="">Seleccionar servicio</option>
              {services.filter((s) => s.isActive || s.id === serviceId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.duration} min · ${Number(s.price).toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Profesional *</label>
            <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className="input" required>
              <option value="">Seleccionar profesional</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.user?.name || p.id}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Fecha *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input"
                required
                min={booking && dayOf(booking.date) < today ? dayOf(booking.date) : today}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Hora *</label>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input" required>
                <option value="">Seleccionar hora</option>
                {extraTime && (
                  <option value={extraTime}>
                    {extraTime}{currentAvailability?.status === 'ok' ? ' (no disponible)' : ''}
                  </option>
                )}
                {timeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          {slotsHint && <p className="text-xs text-amber-400 -mt-2">{slotsHint}</p>}

          {selectedService && (
            <div className="rounded-lg bg-brand-500/10 border border-brand-500/20 p-3 text-xs text-brand-400">
              {selectedService.name} · {selectedService.duration} min · ${Number(selectedService.price).toLocaleString()}
            </div>
          )}

          {isEdit ? (
            <p className="text-xs text-slate-500">
              Cliente: <span className="text-slate-300">{booking?.client?.name ?? '—'}</span>
            </p>
          ) : (
            <div className="border-t border-slate-700/50 pt-4">
              <p className="text-xs font-medium text-slate-400 mb-3">Datos del cliente (opcional)</p>
              <div className="space-y-3">
                <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} className="input" placeholder="Nombre del cliente" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="input" placeholder="Teléfono" />
                  <input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="input" placeholder="Email" />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Notas</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input min-h-[60px] resize-none" placeholder="Notas internas..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              {saving ? (isEdit ? 'Guardando...' : 'Creando...') : isEdit ? 'Guardar cambios' : 'Crear reserva'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
