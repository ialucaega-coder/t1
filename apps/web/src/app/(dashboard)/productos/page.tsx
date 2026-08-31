'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useProducts } from '@/hooks/use-products';
import type { Product as ApiProduct } from '@/types';
import { type Product as LegacyProduct } from '@/constants/products';
import { ProductCard } from '@/components/products/ProductCard';
import { ProductFormModal } from '@/components/products/ProductFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

function toLegacyProduct(product: ApiProduct): LegacyProduct {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    category: product.category?.name ?? '',
    isActive: product.isActive,
  };
}

export default function ProductosPage() {
  const { products, isLoading, error, refetch } = useProducts();
  const [showCreate, setShowCreate] = useState(false);
  const legacyProducts = products.map(toLegacyProduct);

  const handleSave = async (data: { name: string; description: string; price: number; stock: number; category: string; sku: string }) => {
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Tu catálogo de productos. Los clientes pueden verlos desde el chat y hacer pedidos.
        </p>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo producto
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando productos..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {legacyProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <ProductFormModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSave={handleSave} />
    </div>
  );
}
