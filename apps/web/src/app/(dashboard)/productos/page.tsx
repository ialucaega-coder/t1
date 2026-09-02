'use client';

import { useState } from 'react';
import { Plus, DollarSign, Package, Pencil, Trash2, ToggleLeft, ToggleRight, Search } from 'lucide-react';
import { useProducts } from '@/hooks/use-products';
import { ProductFormModal } from '@/components/products/ProductFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import type { Product } from '@/types';

export default function ProductosPage() {
  const { products, isLoading, error, refetch, createProduct, updateProduct, deleteProduct } = useProducts();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = products.filter((p) => p.isActive).length;

  async function handleSave(data: { name: string; description: string; price: number; stock: number; category: string; sku: string }) {
    if (editing) {
      await updateProduct(editing.id, {
        name: data.name,
        price: data.price,
        stock: data.stock,
        isActive: editing.isActive,
      });
    } else {
      await createProduct({
        name: data.name,
        price: data.price,
        stock: data.stock,
      });
    }
    setEditing(null);
  }

  async function handleToggle(product: Product) {
    setToggling(product.id);
    await updateProduct(product.id, { isActive: !product.isActive });
    setToggling(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este producto?')) return;
    setDeleting(id);
    await deleteProduct(id);
    setDeleting(null);
  }

  function handleEdit(product: Product) {
    setEditing(product);
    setShowModal(true);
  }

  if (isLoading) return <LoadingSpinner label="Cargando productos..." />;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Productos</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {products.length} producto{products.length !== 1 ? 's' : ''} · {activeCount} activo{activeCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo producto
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 pl-9 text-sm text-white placeholder:text-slate-600 focus:border-brand-400/50 focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-slate-500">{search ? 'Sin resultados' : 'No hay productos creados'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((product) => (
            <div key={product.id}
              className={`rounded-xl border p-4 transition-all ${
                product.isActive
                  ? 'border-slate-700/50 bg-slate-800/30'
                  : 'border-slate-700/30 bg-slate-800/10 opacity-60'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{product.name}</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{product.category?.name || 'Sin categoría'}</p>
                </div>
                <button
                  onClick={() => handleToggle(product)}
                  disabled={toggling === product.id}
                  className="shrink-0 disabled:opacity-50"
                  title={product.isActive ? 'Desactivar' : 'Activar'}
                >
                  {product.isActive ? (
                    <ToggleRight className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-slate-600" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-400 mb-3">
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" /> ${product.price.toLocaleString('es-AR')}
                </span>
                <span className="flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" /> {product.stock} en stock
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleEdit(product)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">
                  <Pencil className="h-3 w-3" /> Editar
                </button>
                <button onClick={() => handleDelete(product.id)}
                  disabled={deleting === product.id}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  <Trash2 className="h-3 w-3" /> {deleting === product.id ? '...' : 'Eliminar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProductFormModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing ? {
          name: editing.name,
          price: editing.price,
          stock: editing.stock,
          category: editing.category?.name || '',
        } : undefined}
        title={editing ? 'Editar producto' : 'Nuevo producto'}
      />
    </div>
  );
}
