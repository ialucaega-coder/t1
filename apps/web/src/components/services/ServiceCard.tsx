import { Clock, DollarSign, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
import { type Service } from '@/constants/services';

export interface ServiceCardProps {
  service: Service;
}

export function ServiceCard({ service }: ServiceCardProps) {
  return (
    <div className={`card-accent ${!service.isActive ? 'opacity-50' : ''}`}>
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
  );
}
