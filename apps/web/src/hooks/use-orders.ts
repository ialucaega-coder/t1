'use client';

import { useCallback, useEffect, useState } from 'react';
import { ordersApi } from '@/lib/api/index';
import type { CreateOrderData, Order } from '@/types';

// No existe un archivo de constantes para pedidos todavía; se define un
// fallback mínimo aquí mismo para cuando la API no está disponible.
const MOCK_ORDERS: Order[] = [
  {
    id: 'mock-1',
    status: 'COMPLETED',
    totalPrice: 8500,
    createdAt: new Date().toISOString(),
    client: { id: 'mock-client-1', name: 'María García' },
    items: [{ id: 'mock-item-1', quantity: 1, price: 8500, product: { name: 'Shampoo Profesional 500ml' } }],
  },
];

export interface UseOrdersResult {
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createOrder: (data: CreateOrderData) => Promise<Order | null>;
  updateOrderStatus: (id: string, status: string) => Promise<void>;
}

export function useOrders(params?: Record<string, string>): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await ordersApi.getOrders(params);
        if (!cancelled) setOrders(data.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar pedidos');
          setOrders(MOCK_ORDERS);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const createOrder = useCallback(async (data: CreateOrderData) => {
    try {
      const created = await ordersApi.createOrder(data);
      setOrders((prev) => [created, ...prev]);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el pedido');
      return null;
    }
  }, []);

  const updateOrderStatus = useCallback(async (id: string, status: string) => {
    try {
      const updated = await ordersApi.updateOrderStatus(id, status);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar el pedido');
    }
  }, []);

  return { orders, isLoading, error, refetch, createOrder, updateOrderStatus };
}
