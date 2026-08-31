'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';

interface ProductFormData {
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  sku: string;
}

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProductFormData) => Promise<void>;
  initial?: Partial<ProductFormData>;
  title?: string;
}

const CATEGORIES = ['Cabello', 'Barba', 'Uñas', 'Skincare', 'Accesorios', 'Otro'];

export function ProductFormModal({ isOpen, onClose, onSave, initial, title }: ProductFormModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(0);
  const [category, setCategory] = useState('Cabello');
  const [sku, setSku] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && initial) {
      setName(initial.name ?? ''); setDescription(initial.description ?? '');
      setPrice(initial.price ?? 0); setStock(initial.stock ?? 0);
      setCategory(initial.category ?? 'Cabello'); setSku(initial.sku ?? '');
    } else if (isOpen) {
      setName(''); setDescription(''); setPrice(0); setStock(0); setCategory('Cabello'); setSku('');
    }
    setError('');
  }, [isOpen, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio'); return; }
    if (price <= 0) { setError('El precio debe ser mayor a 0'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description, price, stock, category, sku });
      onClose();
    } catch { setError('Error al guardar'); } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title ?? 'Nuevo producto'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Nombre *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Ej: Shampoo anti-caída" required />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Descripción</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-[60px] resize-none" placeholder="Descripción del producto..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Precio *</label>
            <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="input" min={0} step={100} required />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Stock</label>
            <input type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} className="input" min={0} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Categoría</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">SKU</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} className="input" placeholder="SKU-001" />
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
