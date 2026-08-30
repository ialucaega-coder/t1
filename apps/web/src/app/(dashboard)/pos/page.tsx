'use client';

import { useCart } from '@/hooks';
import { QUICK_ITEMS as quickItems } from '@/constants/pos';
import { QuickItemGrid } from '@/components/pos/QuickItemGrid';
import { CartItem } from '@/components/pos/CartItem';
import { PaymentButtons } from '@/components/pos/PaymentButtons';

export default function POSPage() {
  const { cart, addToCart, removeFromCart, updateQty, total } = useCart();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
      <div className="lg:col-span-2 space-y-4">
        <h3 className="mono-label">PRODUCTOS Y SERVICIOS</h3>
        <QuickItemGrid items={quickItems} onAdd={addToCart} />
      </div>

      <div className="card flex flex-col">
        <h3 className="mono-label mb-4">TICKET ACTUAL</h3>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Agrega productos o servicios</p>
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

        <div className="border-t border-slate-800 pt-4 mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Total</span>
            <span className="text-2xl font-bold text-white">${total.toLocaleString('es-AR')}</span>
          </div>

          <PaymentButtons disabled={cart.length === 0} />
        </div>
      </div>
    </div>
  );
}
