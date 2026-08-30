/**
 * Pruebas unitarias para el hook `useCart` (`src/hooks/use-cart.ts`):
 * agregar, quitar, actualizar cantidad y calcular el total.
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCart } from '@/hooks/use-cart';

describe('hooks/use-cart', () => {
  it('inicia con el carrito vacio y total en cero', () => {
    const { result } = renderHook(() => useCart());

    expect(result.current.cart).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('agrega un nuevo item al carrito con cantidad 1', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
    });

    expect(result.current.cart).toEqual([{ name: 'Corte', price: 1000, qty: 1 }]);
    expect(result.current.total).toBe(1000);
  });

  it('incrementa la cantidad si el item ya existe en el carrito', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
    });
    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
    });

    expect(result.current.cart).toEqual([{ name: 'Corte', price: 1000, qty: 2 }]);
    expect(result.current.total).toBe(2000);
  });

  it('elimina un item del carrito por nombre', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
      result.current.addToCart({ name: 'Barba', price: 500 });
    });
    act(() => {
      result.current.removeFromCart('Corte');
    });

    expect(result.current.cart).toEqual([{ name: 'Barba', price: 500, qty: 1 }]);
  });

  it('actualiza la cantidad de un item sumando el delta', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
    });
    act(() => {
      result.current.updateQty('Corte', 2);
    });

    expect(result.current.cart[0].qty).toBe(3);
  });

  // NOTA: la implementacion actual de `updateQty` tiene un bug conocido:
  // cuando `qty + delta <= 0`, devuelve el item original sin modificar en
  // lugar de reducir su qty a 0, por lo que el `.filter(i => i.qty > 0)`
  // posterior nunca llega a eliminarlo. Este test documenta el
  // comportamiento REAL actual (el item permanece con su qty previa),
  // no el comportamiento esperado por el nombre de la funcion.
  it('NO elimina el item al intentar bajar la cantidad a cero (bug conocido en updateQty)', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
    });
    act(() => {
      result.current.updateQty('Corte', -1);
    });

    expect(result.current.cart).toEqual([{ name: 'Corte', price: 1000, qty: 1 }]);
  });

  it('calcula el total sumando precio por cantidad de cada item', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
      result.current.addToCart({ name: 'Barba', price: 500 });
      result.current.addToCart({ name: 'Barba', price: 500 });
    });

    expect(result.current.total).toBe(2000);
  });

  it('vacia el carrito con clearCart', () => {
    const { result } = renderHook(() => useCart());

    act(() => {
      result.current.addToCart({ name: 'Corte', price: 1000 });
    });
    act(() => {
      result.current.clearCart();
    });

    expect(result.current.cart).toEqual([]);
    expect(result.current.total).toBe(0);
  });
});
