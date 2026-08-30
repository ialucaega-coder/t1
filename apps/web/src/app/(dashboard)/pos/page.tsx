'use client';

import { useState } from 'react';
import { Plus, Minus, CreditCard, Banknote, QrCode, ArrowRightLeft, Trash2 } from 'lucide-react';

type CartItem = { name: string; price: number; qty: number };

const quickItems = [
  { name: 'Corte caballero', price: 5000 },
  { name: 'Corte + Peinado', price: 8000 },
  { name: 'Barba', price: 3000 },
  { name: 'Color completo', price: 15000 },
  { name: 'Shampoo 500ml', price: 8500 },
  { name: 'Cera cabello', price: 4500 },
  { name: 'Tratamiento capilar', price: 12000 },
  { name: 'Manicura', price: 4500 },
];

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addToCart = (item: { name: string; price: number }) => {
    setCart(prev => {
      const existing = prev.find(i => i.name === item.name);
      if (existing) {
        return prev.map(i => i.name === item.name ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (name: string) => {
    setCart(prev => prev.filter(i => i.name !== name));
  };

  const updateQty = (name: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.name !== name) return i;
      const newQty = i.qty + delta;
      return newQty <= 0 ? i : { ...i, qty: newQty };
    }).filter(i => i.qty > 0));
  };

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
      <div className="lg:col-span-2 space-y-4">
        <h3 className="mono-label">PRODUCTOS Y SERVICIOS</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {quickItems.map((item) => (
            <button
              key={item.name}
              onClick={() => addToCart(item)}
              className="card-accent text-left hover:border-brand-500/70 active:scale-[0.98] transition-all"
            >
              <p className="text-sm font-medium text-white mb-1">{item.name}</p>
              <p className="text-xs text-brand-400 font-mono">${item.price.toLocaleString('es-AR')}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="card flex flex-col">
        <h3 className="mono-label mb-4">TICKET ACTUAL</h3>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Agrega productos o servicios</p>
          ) : (
            cart.map((item) => (
              <div key={item.name} className="flex items-center gap-2 rounded-lg bg-surface p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.name}</p>
                  <p className="text-xs text-slate-500 font-mono">${item.price.toLocaleString('es-AR')}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(item.name, -1)} className="p-1 rounded hover:bg-surface-100">
                    <Minus className="h-3 w-3 text-slate-400" />
                  </button>
                  <span className="text-sm font-medium text-white w-6 text-center">{item.qty}</span>
                  <button onClick={() => updateQty(item.name, 1)} className="p-1 rounded hover:bg-surface-100">
                    <Plus className="h-3 w-3 text-slate-400" />
                  </button>
                </div>
                <button onClick={() => removeFromCart(item.name)} className="p-1 rounded hover:bg-surface-100">
                  <Trash2 className="h-3 w-3 text-red-400" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-800 pt-4 mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Total</span>
            <span className="text-2xl font-bold text-white">${total.toLocaleString('es-AR')}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary text-xs justify-center" disabled={cart.length === 0}>
              <Banknote className="h-3.5 w-3.5" /> Efectivo
            </button>
            <button className="btn-secondary text-xs justify-center" disabled={cart.length === 0}>
              <CreditCard className="h-3.5 w-3.5" /> Tarjeta
            </button>
            <button className="btn-secondary text-xs justify-center" disabled={cart.length === 0}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
            </button>
            <button className="btn-secondary text-xs justify-center" disabled={cart.length === 0}>
              <QrCode className="h-3.5 w-3.5" /> QR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
