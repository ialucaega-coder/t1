'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Clock, DollarSign, Pencil, Trash2, ToggleLeft, ToggleRight, Search, Briefcase, Tag } from 'lucide-react';
import { useServices } from '@/hooks/use-services';
import * as categoriesApi from '@/lib/api/categories';
import { CategoryManagerModal } from '@/components/categories/CategoryManagerModal';
import type { Category } from '@/types';
import { ServiceFormModal } from '@/components/services/ServiceFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import type { Service } from '@/types';

export default function ServiciosPage() {
  const { services, isLoading, error, refetch, createService, updateService, deleteService } = useServices();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategories, setShowCategories] = useState(false);
  // '' = todas · 'none' = sin categoría · otro valor = id de categoría
  const [categoryFilter, setCategoryFilter] = useState('');

  const loadCategories = useCallback(() => {
    categoriesApi.getCategories().then(setCategories).catch(() => {});
  }, []);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const filtered = services
    .filter((s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.category?.name || '').toLowerCase().includes(search.toLowerCase())
    )
    .filter((s) => {
      const catId = s.categoryId || s.category?.id || '';
      if (categoryFilter === 'none') return !catId;
      return categoryFilter === '' || catId === categoryFilter;
    })
    // Orden manual (sortOrder); sort estable: a igual orden se mantiene el del server.
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const hasFilters = search !== '' || categoryFilter !== '';

  const activeCount = services.filter((s) => s.isActive).length;

  async function handleSave(data: { name: string; description: string; duration: number; price: number; categoryId: string; image: string; sortOrder: number }) {
    const payload = {
      name: data.name,
      description: data.description.trim() || undefined,
      duration: data.duration,
      price: data.price,
      // null = quitar (al editar) / dejar sin categoría o sin imagen.
      categoryId: data.categoryId || null,
      image: data.image || null,
      sortOrder: data.sortOrder,
    };
    if (editing) {
      await updateService(editing.id, { ...payload, isActive: editing.isActive }, { throwOnError: true });
      toast({ type: 'success', message: 'Servicio actualizado correctamente' });
    } else {
      await createService(payload, { throwOnError: true });
      toast({ type: 'success', message: 'Servicio creado correctamente' });
    }
    setEditing(null);
  }

  async function handleToggle(service: Service) {
    setToggling(service.id);
    try {
      await updateService(service.id, { isActive: !service.isActive }, { throwOnError: true });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al actualizar el servicio' });
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
      await deleteService(confirmDelete, { throwOnError: true });
      toast({ type: 'success', message: 'Servicio eliminado correctamente' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al eliminar el servicio' });
    } finally {
      setDeleting(null);
    }
  }

  function handleEdit(service: Service) {
    setEditing(service);
    setShowModal(true);
  }

  if (isLoading) return <LoadingSpinner label="Cargando servicios..." />;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Servicios</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {services.length} servicio{services.length !== 1 ? 's' : ''} · {activeCount} activo{activeCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCategories(true)} className="btn-secondary text-xs">
            <Tag className="h-3.5 w-3.5" /> Categorías
          </button>
          <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Nuevo servicio
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
          placeholder="Buscar servicio..."
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
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={hasFilters ? 'Sin resultados' : 'No hay servicios creados'}
          description={hasFilters ? undefined : 'Creá tu primer servicio para que tus clientes puedan reservar.'}
          action={!hasFilters ? { label: 'Crear servicio', onClick: () => { setEditing(null); setShowModal(true); } } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((service) => (
            <div key={service.id}
              className={`rounded-xl border p-4 transition-all ${
                service.isActive
                  ? 'border-slate-700/50 bg-slate-800/30'
                  : 'border-slate-700/30 bg-slate-800/10 opacity-60'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3 min-w-0">
                  {service.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={service.image}
                      alt={service.name}
                      referrerPolicy="no-referrer"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      className="h-12 w-12 shrink-0 rounded-lg border border-slate-700 object-cover"
                    />
                  )}
                  <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">{service.name}</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{service.category?.name || 'Sin categoría'}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(service)}
                  disabled={toggling === service.id}
                  className="shrink-0 disabled:opacity-50"
                  title={service.isActive ? 'Desactivar' : 'Activar'}
                >
                  {service.isActive ? (
                    <ToggleRight className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-slate-600" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-400 mb-3">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {service.duration} min
                </span>
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" /> ${service.price.toLocaleString('es-AR')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleEdit(service)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">
                  <Pencil className="h-3 w-3" /> Editar
                </button>
                <button onClick={() => handleDelete(service.id)}
                  disabled={deleting === service.id}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  <Trash2 className="h-3 w-3" /> {deleting === service.id ? '...' : 'Eliminar'}
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
        title="Eliminar servicio"
        message="¿Eliminar este servicio? Las reservas existentes no se verán afectadas."
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

      <ServiceFormModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        onSave={handleSave}
        categories={categories}
        initial={editing ? {
          name: editing.name,
          description: editing.description || '',
          duration: editing.duration,
          price: editing.price,
          categoryId: editing.categoryId || editing.category?.id || '',
          image: editing.image || '',
          sortOrder: editing.sortOrder ?? 0,
        } : undefined}
        title={editing ? 'Editar servicio' : 'Nuevo servicio'}
      />
    </div>
  );
}
