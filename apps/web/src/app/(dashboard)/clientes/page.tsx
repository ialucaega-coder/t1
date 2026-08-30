'use client';

import { useState } from 'react';
import { Search, Filter, UserPlus } from 'lucide-react';
import { useClients } from '@/hooks/use-clients';
import type { Client as ApiClient } from '@/types';
import { type Client as LegacyClient, type ClientStatus } from '@/constants/clients';
import { ClientTable } from '@/components/clients/ClientTable';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

// La API no expone un "temperature" de cliente (hot/warm/cold); se deriva a
// partir de la cantidad de reservas históricas para mantener el mismo tipo
// de badge que la UI legacy.
function deriveStatus(totalBookings: number): ClientStatus {
  if (totalBookings >= 10) return 'hot';
  if (totalBookings >= 5) return 'warm';
  return 'cold';
}

// Adapta el shape de `Client` de la API (createdAt/bookingsAsClient/_count)
// al shape simplificado que consume `ClientTable` (lastVisit/totalBookings/status).
function toLegacyClient(client: ApiClient): LegacyClient {
  const totalBookings = client._count?.bookingsAsClient ?? 0;
  const lastVisit = client.bookingsAsClient?.[0]?.date ?? client.createdAt;
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone ?? '',
    lastVisit,
    totalBookings,
    status: deriveStatus(totalBookings),
  };
}

export default function ClientesPage() {
  const [search, setSearch] = useState('');
  const { clients, isLoading, error, refetch, searchClients } = useClients();

  const handleSearchChange = (value: string) => {
    setSearch(value);
    searchClients(value);
  };

  const legacyClients = clients.map(toLegacyClient);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Todos tus clientes, en un solo lugar. Los leads que capturan TODOS tus bots — nombre, canal,
        qué quieren y cuándo — en una bandeja.
      </p>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por nombre, email o teléfono..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="input pl-10"
          />
        </div>
        <button className="btn-secondary text-xs">
          <Filter className="h-3.5 w-3.5" /> Filtrar
        </button>
        <button className="btn-primary text-xs">
          <UserPlus className="h-3.5 w-3.5" /> Agregar cliente
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {isLoading ? <LoadingSpinner label="Cargando clientes..." /> : <ClientTable clients={legacyClients} />}
    </div>
  );
}
