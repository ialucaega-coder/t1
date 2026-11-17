'use client';

import { useCallback, useEffect, useState } from 'react';
import { productsApi } from '@/lib/api/index';
import type { Product } from '@/types';
import type { ProductUpdate } from '@/lib/api/products';

interface MutationOptions {
  throwOnError?: boolean;
}

export interface UseProductsResult {
  products: Product[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Con `{ throwOnError: true }` el error se relanza (con el mensaje real del server)
   * en vez de guardarse en `error`: lo usan los formularios para mostrarlo en el modal.
   */
  createProduct: (data: Partial<Product>, opts?: MutationOptions) => Promise<Product | null>;
  updateProduct: (id: string, data: ProductUpdate, opts?: MutationOptions) => Promise<void>;
  deleteProduct: (id: string, opts?: MutationOptions) => Promise<void>;
}

export function useProducts(): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await productsApi.getProducts();
        if (!cancelled) setProducts(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar productos');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const createProduct = useCallback(async (data: Partial<Product>, opts?: MutationOptions) => {
    try {
      const created = await productsApi.createProduct(data);
      setProducts((prev) => [...prev, created]);
      return created;
    } catch (err) {
      if (opts?.throwOnError) throw err;
      setError(err instanceof Error ? err.message : 'Error al crear el producto');
      return null;
    }
  }, []);

  const updateProduct = useCallback(async (id: string, data: ProductUpdate, opts?: MutationOptions) => {
    try {
      const updated = await productsApi.updateProduct(id, data);
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      if (opts?.throwOnError) throw err;
      setError(err instanceof Error ? err.message : 'Error al actualizar el producto');
    }
  }, []);

  const deleteProduct = useCallback(async (id: string, opts?: MutationOptions) => {
    try {
      await productsApi.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      if (opts?.throwOnError) throw err;
      setError(err instanceof Error ? err.message : 'Error al eliminar el producto');
    }
  }, []);

  return { products, isLoading, error, refetch, createProduct, updateProduct, deleteProduct };
}
