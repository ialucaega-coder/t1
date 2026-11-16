'use client';

import { useEffect, useState } from 'react';
import * as ordersApi from '@/lib/api/orders';
import type { Order } from '@/types';

interface OrderNotesProps {
  order: Order;
  onSaved: (order: Order) => void;
}

/** Nota interna editable de un pedido (se guarda en el campo `notes` del pedido). */
export function OrderNotes({ order, onSaved }: OrderNotesProps) {
  const [value, setValue] = useState(order.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Al cambiar de pedido (o si el server devuelve otra versión) resincronizamos.
  useEffect(() => {
    setValue(order.notes ?? '');
    setError('');
  }, [order.id, order.notes]);

  const dirty = value.trim() !== (order.notes ?? '').trim();

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await ordersApi.updateOrderNotes(order.id, value);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'No se pudo guardar la nota');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg bg-slate-900/50 p-3">
      <label htmlFor={`order-notes-${order.id}`} className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">
        Nota interna
      </label>
      <textarea
        id={`order-notes-${order.id}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Agregá una nota sobre este pedido..."
        className="input w-full text-xs resize-y"
      />
      {error && <p role="alert" className="text-[10px] text-red-400 mt-1">{error}</p>}
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="btn-secondary text-xs disabled:opacity-40"
        >
          {saving ? 'Guardando...' : 'Guardar nota'}
        </button>
      </div>
    </div>
  );
}
