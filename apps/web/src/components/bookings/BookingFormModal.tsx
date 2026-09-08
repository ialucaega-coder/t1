'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { getServices } from '@/lib/api/services';
import { getProfessionals } from '@/lib/api/professionals';
import type { CreateBookingData, Service, Professional } from '@/types';

interface BookingFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateBookingData) => Promise<void>;
  initialDate?: string;
  initialTime?: string;
}

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 20; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 20) slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

const ALL_TIME_SLOTS = generateTimeSlots();

export function BookingFormModal({ isOpen, onClose, onSubmit, initialDate, initialTime }: BookingFormModalProps) {
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

  const selectedService = services.find((s) => s.id === serviceId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceId || !professionalId || !date || !startTime) {
      setError('Completa todos los campos obligatorios');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSubmit({ serviceId, professionalId, date, startTime, notes: notes || undefined, source: 'MANUAL' });
      onClose();
    } catch {
      setError('Error al crear la reserva');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nueva reserva" size="md">
      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Cargando datos...</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Servicio *</label>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input" required>
              <option value="">Seleccionar servicio</option>
              {services.filter((s) => s.isActive).map((s) => (
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
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" required min={today} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Hora *</label>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input" required>
                <option value="">Seleccionar hora</option>
                {ALL_TIME_SLOTS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedService && (
            <div className="rounded-lg bg-brand-500/10 border border-brand-500/20 p-3 text-xs text-brand-400">
              {selectedService.name} · {selectedService.duration} min · ${Number(selectedService.price).toLocaleString()}
            </div>
          )}

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

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Notas</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input min-h-[60px] resize-none" placeholder="Notas internas..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              {saving ? 'Creando...' : 'Crear reserva'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
