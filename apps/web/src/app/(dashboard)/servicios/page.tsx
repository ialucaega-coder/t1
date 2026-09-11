'use client';

import { useState } from 'react';
import { Plus, Clock, DollarSign, Pencil, Trash2, ToggleLeft, ToggleRight, Search, Briefcase } from 'lucide-react';
import { useServices } from '@/hooks/use-services';
import { ServiceFormModal } from '@/components/services/ServiceFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import type { Service } from '@/types';

export default function ServiciosPage() {
  const { services, isLoading, error, refetch, createService, updateService, deleteService } = useServices();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = services.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.category?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = services.filter((s) => s.isActive).length;

  async function handleSave(data: { name: string; description: string; duration: number; price: number; category: string }) {
    if (editing) {
      await updateService(editing.id, {
        name: data.name,
        duration: data.duration,
        price: data.price,
        isActive: editing.isActive,
      });
    } else {
      await createService({
        name: data.name,
        duration: data.duration,
        price: data.price,
      });
    }
    setEditing(null);
  }

  async function handleToggle(service: Service) {
    setToggling(service.id);
    await updateService(service.id, { isActive: !service.isActive });
    setToggling(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este servicio? Las reservas existentes no se verán afectadas.')) return;
    setDeleting(id);
    await deleteService(id);
    setDeleting(null);
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
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo servicio
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar servicio..."
          className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 pl-9 text-sm text-white placeholder:text-slate-600 focus:border-brand-400/50 focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={search ? 'Sin resultados' : 'No hay servicios creados'}
          description={search ? undefined : 'Creá tu primer servicio para que tus clientes puedan reservar.'}
          action={!search ? { label: 'Crear servicio', onClick: () => setEditing({} as Service) } : undefined}
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
                <div>
                  <h3 className="text-sm font-semibold text-white">{service.name}</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{service.category?.name || 'Sin categoría'}</p>
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

      <ServiceFormModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing ? {
          name: editing.name,
          duration: editing.duration,
          price: editing.price,
          category: editing.category?.name || '',
        } : undefined}
        title={editing ? 'Editar servicio' : 'Nuevo servicio'}
      />
    </div>
  );
}
