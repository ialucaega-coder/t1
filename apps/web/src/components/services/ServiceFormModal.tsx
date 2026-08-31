'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';

interface ServiceFormData {
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
}

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ServiceFormData) => Promise<void>;
  initial?: Partial<ServiceFormData>;
  title?: string;
}

const CATEGORIES = ['Cortes', 'Color', 'Barbería', 'Uñas', 'Tratamientos', 'Otro'];

export function ServiceFormModal({ isOpen, onClose, onSave, initial, title }: ServiceFormModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);
  const [category, setCategory] = useState('Cortes');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && initial) {
      setName(initial.name ?? '');
      setDescription(initial.description ?? '');
      setDuration(initial.duration ?? 30);
      setPrice(initial.price ?? 0);
      setCategory(initial.category ?? 'Cortes');
    } else if (isOpen) {
      setName(''); setDescription(''); setDuration(30); setPrice(0); setCategory('Cortes');
    }
    setError('');
  }, [isOpen, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio'); return; }
    if (price <= 0) { setError('El precio debe ser mayor a 0'); return; }
    if (duration <= 0) { setError('La duración debe ser mayor a 0'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description, duration, price, category });
      onClose();
    } catch { setError('Error al guardar'); } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title ?? 'Nuevo servicio'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Nombre *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Ej: Corte + Peinado" required />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Descripción</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-[60px] resize-none" placeholder="Descripción del servicio..." />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Duración (min) *</label>
            <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input" min={5} step={5} required />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Precio *</label>
            <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="input" min={0} step={100} required />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Categoría</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-primary text-xs">{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}
