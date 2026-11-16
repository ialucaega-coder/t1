'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, DollarSign, Package, Pencil, Trash2, ToggleLeft, ToggleRight, Search, ShoppingBag, Tag, AlertTriangle } from 'lucide-react';
import { useProducts } from '@/hooks/use-products';
import * as categoriesApi from '@/lib/api/categories';
import { isLowStock, LOW_STOCK_THRESHOLD } from '@/lib/stock';
import { CategoryManagerModal } from '@/components/categories/CategoryManagerModal';
import type { Category } from '@/types';
import { ProductFormModal } from '@/components/products/ProductFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import type { Product } from '@/types';

export default function ProductosPage() {
  const { products, isLoading, error, refetch, createProduct, updateProduct, deleteProduct } = useProducts();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategories, setShowCategories] = useState(false);
  // '' = todas · 'none' = sin categoría · otro valor = id de categoría
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const loadCategories = useCallback(() => {
    categoriesApi.getCategories().then(setCategories).catch(() => {});
  }, []);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const filtered = products
    .filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category?.name || '').toLowerCase().includes(search.toLowerCase())
    )
    .filter((p) => {
      const catId = p.categoryId || p.category?.id || '';
      if (categoryFilter === 'none') return !catId;
      return categoryFilter === '' || catId === categoryFilter;
    })
    .filter((p) => !lowStockOnly || isLowStock(p.stock))
    // Orden manual (sortOrder); sort estable: a igual orden se mantiene el del server.
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const hasFilters = search !== '' || categoryFilter !== '' || lowStockOnly;
  const activeCount = products.filter((p) => p.isActive).length;
  const lowStockCount = products.filter((p) => isLowStock(p.stock)).length;

  async function handleSave(data: { name: string; description: string; price: number; stock: number; categoryId: string; image: string; sortOrder: number }) {
    const payload = {
      name: data.name,
      description: data.description.trim() || undefined,
      price: data.price,
      stock: data.stock,
      // null = quitar (al editar) / dejar sin categoría o sin imagen.
      categoryId: data.categoryId || null,
      image: data.image || null,
      sortOrder: data.sortOrder,
    };
    if (editing) {
      await updateProduct(editing.id, { ...payload, isActive: editing.isActive }, { throwOnError: true });
      toast({ type: 'success', message: 'Producto actualizado correctamente' });
    } else {
      await createProduct(payload, { throwOnError: true });
      toast({ type: 'success', message: 'Producto creado correctamente' });
    }
    setEditing(null);
  }

  async function handleToggle(product: Product) {
    setToggling(product.id);
    try {
      await updateProduct(product.id, { isActive: !product.isActive }, { throwOnError: true });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al actualizar el producto' });
    } finally {
      setToggling(null);
    }
  }

  function handleDelete(id: string) {
    setConfirmDelete(id);
  }

  async function executeDelete() {
    if (!confirmDelete) return;
    setDeleting(confirmDelete);
    setConfirmDelete(null);
    try {
      await deleteProduct(confirmDelete, { throwOnError: true });
      toast({ type: 'success', message: 'Producto eliminado correctamente' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al eliminar el producto' });
    } finally {
      setDeleting(null);
    }
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
            {lowStockCount > 0 && ` · ${lowStockCount} con stock bajo`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCategories(true)} className="btn-secondary text-xs">
            <Tag className="h-3.5 w-3.5" /> Categorías
          </button>
          <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Nuevo producto
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
      <div className="relative max-w-sm flex-1 min-w-[12rem]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 pl-9 text-sm text-white placeholder:text-slate-600 focus:border-brand-400/50 focus:outline-none"
        />
      </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filtrar por categoría"
          className="input text-xs py-1.5 w-auto"
        >
          <option value="">Todas las categorías</option>
          <option value="none">Sin categoría</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setLowStockOnly((v) => !v)}
          aria-pressed={lowStockOnly}
          title={`Productos con ${LOW_STOCK_THRESHOLD} unidades o menos`}
          className={`btn-secondary text-xs ${lowStockOnly ? 'text-yellow-400 border-yellow-400/40' : ''}`}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Stock bajo
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title={hasFilters ? 'Sin resultados' : 'No hay productos creados'}
          description={hasFilters ? undefined : 'Agregá productos a tu catálogo para vender online.'}
          action={!hasFilters ? { label: 'Crear producto', onClick: () => { setEditing(null); setShowModal(true); } } : undefined}
        />
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
                <div className="flex items-start gap-3 min-w-0">
                  {product.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image}
                      alt={product.name}
                      referrerPolicy="no-referrer"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      className="h-12 w-12 shrink-0 rounded-lg border border-slate-700 object-cover"
                    />
                  )}
                  <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">{product.name}</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{product.category?.name || 'Sin categoría'}</p>
                  </div>
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
                <span
                  className={`flex items-center gap-1 ${
                    product.stock === 0 ? 'text-red-400' : isLowStock(product.stock) ? 'text-yellow-400' : ''
                  }`}
                >
                  <Package className="h-3.5 w-3.5" /> {product.stock} en stock
                  {isLowStock(product.stock) && (
                    <span className="ml-1 rounded-full border border-current px-1.5 text-[9px] uppercase tracking-wider">
                      {product.stock === 0 ? 'Sin stock' : 'Stock bajo'}
                    </span>
                  )}
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

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={executeDelete}
        title="Eliminar producto"
        message="¿Eliminar este producto?"
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting !== null}
      />

      <CategoryManagerModal
        isOpen={showCategories}
        onClose={() => setShowCategories(false)}
        categories={categories}
        onChanged={() => { loadCategories(); refetch(); }}
      />

      <ProductFormModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        onSave={handleSave}
        categories={categories}
        initial={editing ? {
          name: editing.name,
          description: editing.description || '',
          price: editing.price,
          stock: editing.stock,
          categoryId: editing.categoryId || editing.category?.id || '',
          image: editing.image || '',
          sortOrder: editing.sortOrder ?? 0,
        } : undefined}
        title={editing ? 'Editar producto' : 'Nuevo producto'}
      />
    </div>
  );
}
