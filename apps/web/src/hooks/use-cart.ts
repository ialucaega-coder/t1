'use client';

import { useState } from 'react';

type CartItem = { name: string; price: number; qty: number };

export function useCart() {
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
    // Al bajar la cantidad a 0 (o menos) el ítem se elimina del carrito.
    setCart(prev => prev
      .map(i => (i.name === name ? { ...i, qty: i.qty + delta } : i))
      .filter(i => i.qty > 0));
  };

  const clearCart = () => setCart([]);

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  return { cart, addToCart, removeFromCart, updateQty, total, clearCart };
}
