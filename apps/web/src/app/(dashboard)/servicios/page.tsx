'use client';

import { Plus, Clock, DollarSign, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';

const mockServices = [
  { id: '1', name: 'Corte caballero', duration: 30, price: 5000, category: 'Cortes', isActive: true },
  { id: '2', name: 'Corte + Peinado', duration: 60, price: 8000, category: 'Cortes', isActive: true },
  { id: '3', name: 'Color completo', duration: 120, price: 15000, category: 'Color', isActive: true },
  { id: '4', name: 'Mechas / Highlights', duration: 150, price: 20000, category: 'Color', isActive: true },
  { id: '5', name: 'Barba', duration: 20, price: 3000, category: 'Barbería', isActive: true },
  { id: '6', name: 'Corte + Barba', duration: 45, price: 7000, category: 'Barbería', isActive: true },
  { id: '7', name: 'Manicura', duration: 45, price: 4500, category: 'Uñas', isActive: false },
  { id: '8', name: 'Tratamiento capilar', duration: 60, price: 12000, category: 'Tratamientos', isActive: true },
];

export default function ServiciosPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Tus servicios disponibles para reserva. Cada servicio tiene duración, precio y categoría.
        </p>
        <button className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo servicio
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockServices.map((service) => (
          <div key={service.id} className={`card-accent ${!service.isActive ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-white">{service.name}</h3>
                <p className="mono-label">{service.category}</p>
              </div>
              <button className="text-slate-500 hover:text-white">
                {service.isActive ? (
                  <ToggleRight className="h-5 w-5 text-emerald-400" />
                ) : (
                  <ToggleLeft className="h-5 w-5" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {service.duration} min
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" /> ${service.price.toLocaleString('es-AR')}
              </span>
            </div>
            <button className="btn-secondary text-xs py-1 px-2 mt-3">
              <Pencil className="h-3 w-3" /> Editar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
