'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useServices } from '@/hooks/use-services';
import type { Service as ApiService } from '@/types';
import { type Service as LegacyService } from '@/constants/services';
import { ServiceCard } from '@/components/services/ServiceCard';
import { ServiceFormModal } from '@/components/services/ServiceFormModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

function toLegacyService(service: ApiService): LegacyService {
  return {
    id: service.id,
    name: service.name,
    duration: service.duration,
    price: service.price,
    category: service.category?.name ?? '',
    isActive: service.isActive,
  };
}

export default function ServiciosPage() {
  const { services, isLoading, error, refetch } = useServices();
  const [showCreate, setShowCreate] = useState(false);
  const legacyServices = services.map(toLegacyService);

  const handleSave = async (data: { name: string; description: string; duration: number; price: number; category: string }) => {
    // TODO: connect to real API when backend is available
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Tus servicios disponibles para reserva. Cada servicio tiene duración, precio y categoría.
        </p>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo servicio
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? (
        <LoadingSpinner label="Cargando servicios..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {legacyServices.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      )}

      <ServiceFormModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSave={handleSave} />
    </div>
  );
}
