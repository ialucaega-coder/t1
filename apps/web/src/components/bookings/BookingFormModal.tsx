'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { MOCK_SERVICES } from '@/constants/services';
import { TIME_SLOTS } from '@/constants/bookings';
import type { CreateBookingData } from '@/types';

interface BookingFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateBookingData) => Promise<void>;
  initialDate?: string;
  initialTime?: string;
}

const MOCK_PROFESSIONALS = [
  { id: 'pro-1', name: 'Ana López' },
  { id: 'pro-2', name: 'Carlos Ruiz' },
  { id: 'pro-3', name: 'María Torres' },
];

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

  const selectedService = MOCK_SERVICES.find((s) => s.id === serviceId);

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
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
        )}

        <div>
          <label className="text-xs text-slate-500 mb-1 block">Servicio *</label>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="input" required>
            <option value="">Seleccionar servicio</option>
            {MOCK_SERVICES.filter((s) => s.isActive).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.duration} min · ${s.price.toLocaleString()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">Profesional *</label>
          <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className="input" required>
            <option value="">Seleccionar profesional</option>
            {MOCK_PROFESSIONALS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
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
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              {['08:30','09:30','10:30','11:30','12:30','13:30','14:30','15:30','16:30','17:30','18:30','19:30'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedService && (
          <div className="rounded-lg bg-brand-500/10 border border-brand-500/20 p-3 text-xs text-brand-400">
            {selectedService.name} · {selectedService.duration} min · ${selectedService.price.toLocaleString()}
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
    </Modal>
  );
}
