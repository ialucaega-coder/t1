'use client';

import { useState } from 'react';
import { Search, Filter, UserPlus, Phone, Mail, Calendar, MessageCircle } from 'lucide-react';

const mockClients = [
  { id: '1', name: 'María García', email: 'maria@email.com', phone: '+54 11 5555-0001', lastVisit: '2024-01-15', totalBookings: 12, status: 'hot' },
  { id: '2', name: 'Juan Pérez', email: 'juan@email.com', phone: '+54 11 5555-0002', lastVisit: '2024-01-10', totalBookings: 8, status: 'warm' },
  { id: '3', name: 'Laura Méndez', email: 'laura@email.com', phone: '+54 11 5555-0003', lastVisit: '2024-01-18', totalBookings: 23, status: 'hot' },
  { id: '4', name: 'Roberto Silva', email: 'roberto@email.com', phone: '+54 11 5555-0004', lastVisit: '2023-12-20', totalBookings: 3, status: 'cold' },
  { id: '5', name: 'Ana Torres', email: 'ana@email.com', phone: '+54 11 5555-0005', lastVisit: '2024-01-16', totalBookings: 15, status: 'hot' },
];

const statusConfig: Record<string, { label: string; class: string }> = {
  hot: { label: 'Caliente', class: 'bg-red-500/10 text-red-400 border-red-500/20' },
  warm: { label: 'Tibio', class: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  cold: { label: 'Frío', class: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
};

export default function ClientesPage() {
  const [search, setSearch] = useState('');

  const filtered = search
    ? mockClients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search)
      )
    : mockClients;

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
            onChange={(e) => setSearch(e.target.value)}
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

      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Cliente</th>
              <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Contacto</th>
              <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Última visita</th>
              <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Reservas</th>
              <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Interés</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((client) => (
              <tr key={client.id} className="border-b border-slate-800/50 hover:bg-surface-100 transition-colors cursor-pointer">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold">
                      {client.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <span className="text-sm font-medium text-white">{client.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-slate-400">{client.email}</p>
                  <p className="text-xs text-slate-500">{client.phone}</p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{client.lastVisit}</td>
                <td className="px-4 py-3 text-sm font-medium text-white">{client.totalBookings}</td>
                <td className="px-4 py-3">
                  <span className={`badge border ${statusConfig[client.status].class}`}>
                    {statusConfig[client.status].label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-surface-100">
                      <MessageCircle className="h-3.5 w-3.5" />
                    </button>
                    <button className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-surface-100">
                      <Calendar className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
