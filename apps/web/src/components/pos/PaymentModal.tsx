'use client';

import { useState } from 'react';
import { X, Banknote, CreditCard, ArrowRightLeft, QrCode, Check, Printer } from 'lucide-react';
import { httpClient } from '@/lib/api/http-client';

type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'QR';

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'CASH', label: 'Efectivo', icon: Banknote },
  { id: 'CARD', label: 'Tarjeta', icon: CreditCard },
  { id: 'TRANSFER', label: 'Transferencia', icon: ArrowRightLeft },
  { id: 'QR', label: 'QR / MercadoPago', icon: QrCode },
];

interface PaymentModalProps {
  total: number;
  items: { name: string; price: number; qty: number }[];
  clientName: string;
  discount: number;
  onClose: () => void;
  onComplete: () => void;
}

export function PaymentModal({ total, items, clientName, discount, onClose, onComplete }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [receiptId, setReceiptId] = useState('');

  const cashAmount = Number(cashReceived) || 0;
  const change = method === 'CASH' ? cashAmount - total : 0;

  async function handlePay() {
    setProcessing(true);
    try {
      const res = await httpClient.post<{ id: string }>('/transactions', {
        amount: total,
        type: 'SALE',
        paymentMethod: method,
        notes: clientName ? `Cliente: ${clientName}` : undefined,
        reference: discount > 0 ? `Descuento ${discount}%` : undefined,
      });
      setReceiptId(res.id?.slice(-8)?.toUpperCase() || 'OK');
      setCompleted(true);
    } catch {
      setReceiptId('LOCAL');
      setCompleted(true);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface-100 border border-slate-700/50 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-white">
            {completed ? 'Venta completada' : 'Cobrar venta'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {completed ? (
          /* Pantalla de éxito */
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="h-8 w-8 text-green-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">
                ${total.toLocaleString('es-AR')}
              </p>
              <p className="text-sm text-slate-400">
                {METHODS.find((m) => m.id === method)?.label}
              </p>
            </div>
            {method === 'CASH' && change > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-400 uppercase font-mono">Vuelto</p>
                <p className="text-xl font-bold text-amber-400 font-mono">
                  ${change.toLocaleString('es-AR')}
                </p>
              </div>
            )}
            <p className="text-xs text-slate-500 font-mono">Recibo #{receiptId}</p>
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="btn-secondary text-xs flex-1 justify-center"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir
              </button>
              <button
                onClick={onComplete}
                className="btn-primary text-xs flex-1 justify-center"
              >
                Nueva venta
              </button>
            </div>
          </div>
        ) : (
          /* Formulario de pago */
          <div className="p-5 space-y-4">
            {/* Resumen */}
            <div className="bg-surface rounded-lg p-3 space-y-1">
              {items.map((item) => (
                <div key={item.name} className="flex justify-between text-xs text-slate-400">
                  <span>{item.qty}x {item.name}</span>
                  <span className="font-mono">${(item.price * item.qty).toLocaleString('es-AR')}</span>
                </div>
              ))}
              {discount > 0 && (
                <div className="flex justify-between text-xs text-green-400 pt-1 border-t border-slate-700/30">
                  <span>Descuento {discount}%</span>
                  <span className="font-mono">-${(items.reduce((s, i) => s + i.price * i.qty, 0) * discount / 100).toLocaleString('es-AR')}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-white pt-1 border-t border-slate-700/30">
                <span>Total</span>
                <span className="font-mono">${total.toLocaleString('es-AR')}</span>
              </div>
            </div>

            {/* Método de pago */}
            <div>
              <p className="text-xs text-slate-400 mb-2 uppercase font-mono tracking-wide">Método de pago</p>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                        method === m.id
                          ? 'border-brand-400 bg-brand-400/10 text-brand-400'
                          : 'border-slate-700/50 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Monto recibido (solo efectivo) */}
            {method === 'CASH' && (
              <div>
                <p className="text-xs text-slate-400 mb-1.5 uppercase font-mono tracking-wide">Monto recibido</p>
                <input
                  type="number"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder={total.toString()}
                  className="w-full px-3 py-2.5 rounded-lg bg-surface border border-slate-700/50 text-white text-lg font-mono text-right focus:outline-none focus:border-brand-400"
                />
                {cashAmount >= total && cashAmount > 0 && (
                  <p className="text-right text-sm text-green-400 font-mono mt-1">
                    Vuelto: ${change.toLocaleString('es-AR')}
                  </p>
                )}
              </div>
            )}

            {/* Botón cobrar */}
            <button
              onClick={handlePay}
              disabled={processing || (method === 'CASH' && cashAmount > 0 && cashAmount < total)}
              className="btn-primary w-full justify-center text-sm py-3 disabled:opacity-40"
            >
              {processing ? 'Procesando...' : `Cobrar $${total.toLocaleString('es-AR')}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
