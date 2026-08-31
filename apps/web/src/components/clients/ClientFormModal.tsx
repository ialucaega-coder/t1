'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';

interface ClientFormData {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ClientFormData) => Promise<void>;
  initial?: Partial<ClientFormData>;
  title?: string;
}

export function ClientFormModal({ isOpen, onClose, onSave, initial, title }: ClientFormModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && initial) {
      setName(initial.name ?? ''); setEmail(initial.email ?? '');
      setPhone(initial.phone ?? ''); setNotes(initial.notes ?? '');
    } else if (isOpen) {
      setName(''); setEmail(''); setPhone(''); setNotes('');
    }
    setError('');
  }, [isOpen, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Email inválido'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), email, phone, notes });
      onClose();
    } catch { setError('Error al guardar'); } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title ?? 'Nuevo cliente'} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Nombre *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Nombre completo" required />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="cliente@email.com" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Teléfono</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+54 11 1234-5678" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Notas</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input min-h-[60px] resize-none" placeholder="Notas internas..." />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-primary text-xs">{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}
