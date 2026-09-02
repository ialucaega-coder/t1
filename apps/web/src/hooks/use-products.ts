'use client';

import { useCallback, useEffect, useState } from 'react';
import { productsApi } from '@/lib/api/index';
import type { Product } from '@/types';
import { MOCK_PRODUCTS } from '@/constants/products';

// Adapta los productos mock (categoría como string) al shape real de la API
// (categoría como objeto { id, name }).
function adaptMockProducts(): Product[] {
  return MOCK_PRODUCTS.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    stock: p.stock,
    isActive: p.isActive,
    category: { id: p.category, name: p.category },
  }));
}

export interface UseProductsResult {
  products: Product[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createProduct: (data: Partial<Product>) => Promise<Product | null>;
  updateProduct: (id: string, data: Partial<Product>) => Promise<void>;
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
          setProducts(adaptMockProducts());
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

  const createProduct = useCallback(async (data: Partial<Product>) => {
    try {
      const created = await productsApi.createProduct(data);
      setProducts((prev) => [...prev, created]);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el producto');
      return null;
    }
  }, []);

  const updateProduct = useCallback(async (id: string, data: Partial<Product>) => {
    try {
      const updated = await productsApi.updateProduct(id, data);
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar el producto');
    }
  }, []);

  const deleteProduct = useCallback(async (id: string) => {
    try {
      await productsApi.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el producto');
    }
  }, []);

  return { products, isLoading, error, refetch, createProduct, updateProduct, deleteProduct };
}
