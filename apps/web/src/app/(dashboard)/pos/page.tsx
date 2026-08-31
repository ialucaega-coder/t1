'use client';

import { useState } from 'react';
import { useCart } from '@/hooks';
import { usePos } from '@/hooks/use-pos';
import { QuickItemGrid } from '@/components/pos/QuickItemGrid';
import { CartItem } from '@/components/pos/CartItem';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { CashDrawer } from '@/components/pos/CashDrawer';
import { SalesHistory } from '@/components/pos/SalesHistory';
import { PosStats } from '@/components/pos/PosStats';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import {
  ShoppingCart, History, Wallet, BarChart3, Search,
  Trash2, User, ReceiptText,
} from 'lucide-react';

type Tab = 'venta' | 'historial' | 'caja' | 'resumen';

export default function POSPage() {
  const { items, isLoading, error, refetch } = usePos();
  const { cart, addToCart, removeFromCart, updateQty, total, clearCart } = useCart();
  const [tab, setTab] = useState<Tab>('venta');
  const [search, setSearch] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [clientName, setClientName] = useState('');
  const [discount, setDiscount] = useState(0);

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const subtotal = total;
  const discountAmount = subtotal * (discount / 100);
  const finalTotal = subtotal - discountAmount;

  const tabs: { id: Tab; label: string; icon: typeof ShoppingCart }[] = [
    { id: 'venta', label: 'Punto de venta', icon: ShoppingCart },
    { id: 'historial', label: 'Historial ventas', icon: History },
    { id: 'caja', label: 'Arqueo de caja', icon: Wallet },
    { id: 'resumen', label: 'Resumen del día', icon: BarChart3 },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-slate-700/50 pb-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition-colors ${
                tab === t.id
                  ? 'bg-surface-100 text-white border-b-2 border-brand-400'
                  : 'text-slate-400 hover:text-white hover:bg-surface-100/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* PUNTO DE VENTA */}
      {tab === 'venta' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ height: 'calc(100vh - 240px)' }}>
          {/* Panel izquierdo: productos */}
          <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
            {/* Buscador */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar producto o servicio..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface-100 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-400"
              />
            </div>

            {error && <ErrorAlert message={error} onRetry={refetch} />}

            {isLoading ? (
              <LoadingSpinner label="Cargando productos..." />
            ) : (
              <div className="flex-1 overflow-y-auto">
                <QuickItemGrid items={filteredItems} onAdd={addToCart} />
              </div>
            )}
          </div>

          {/* Panel derecho: ticket */}
          <div className="card flex flex-col min-h-0">
            {/* Cabecera ticket */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-brand-400" />
                <h3 className="mono-label">TICKET</h3>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {cart.length} {cart.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            {/* Cliente */}
            <div className="relative mb-3">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Cliente (opcional)"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface border border-slate-700/50 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-400"
              />
            </div>

            {/* Items del carrito */}
            <div className="flex-1 space-y-1.5 overflow-y-auto min-h-0">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                  <ShoppingCart className="h-10 w-10 mb-2 opacity-30" />
                  <p className="text-sm">Carrito vacío</p>
                  <p className="text-xs mt-1">Hacé clic en un producto para agregar</p>
                </div>
              ) : (
                cart.map((item) => (
                  <CartItem
                    key={item.name}
                    item={item}
                    onUpdateQty={updateQty}
                    onRemove={removeFromCart}
                  />
                ))
              )}
            </div>

            {/* Totales y acciones */}
            <div className="border-t border-slate-700/50 pt-3 mt-3 space-y-2">
              {/* Descuento */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Descuento</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discount}
                    onChange={(e) => setDiscount(Math.min(100, Math.max(0, Number(e.target.value))))}
                    className="w-12 text-right px-1 py-0.5 rounded bg-surface border border-slate-700/50 text-white text-xs font-mono focus:outline-none focus:border-brand-400"
                  />
                  <span className="text-slate-500">%</span>
                </div>
              </div>

              {discount > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Subtotal</span>
                    <span className="text-slate-400 font-mono">${subtotal.toLocaleString('es-AR')}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-green-400">Ahorro</span>
                    <span className="text-green-400 font-mono">-${discountAmount.toLocaleString('es-AR')}</span>
                  </div>
                </>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-300">Total</span>
                <span className="text-2xl font-bold text-white font-mono">
                  ${finalTotal.toLocaleString('es-AR')}
                </span>
              </div>

              {/* Botones de acción */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={clearCart}
                  disabled={cart.length === 0}
                  className="btn-secondary text-xs justify-center disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Limpiar
                </button>
                <button
                  onClick={() => setShowPayment(true)}
                  disabled={cart.length === 0}
                  className="btn-primary text-xs justify-center disabled:opacity-30"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  Cobrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HISTORIAL DE VENTAS */}
      {tab === 'historial' && <SalesHistory />}

      {/* ARQUEO DE CAJA */}
      {tab === 'caja' && <CashDrawer />}

      {/* RESUMEN DEL DÍA */}
      {tab === 'resumen' && <PosStats />}

      {/* Modal de pago */}
      {showPayment && (
        <PaymentModal
          total={finalTotal}
          items={cart}
          clientName={clientName}
          discount={discount}
          onClose={() => setShowPayment(false)}
          onComplete={() => {
            clearCart();
            setClientName('');
            setDiscount(0);
            setShowPayment(false);
          }}
        />
      )}
    </div>
  );
}
