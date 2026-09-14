'use client';

import { useState } from 'react';
import { Star, Download, Check, Calendar, ShoppingBag, HeartPulse, UtensilsCrossed, CreditCard, MessageSquare, GraduationCap, Truck, ClipboardList, Gift, Trash2, Store } from 'lucide-react';
import { useMarketplace } from '@/hooks/use-marketplace';
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from '@/constants/marketplace';
import { SearchInput } from '@/components/ui/SearchInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';

const iconMap: Record<string, React.ElementType> = {
  'calendar': Calendar, 'shopping-bag': ShoppingBag, 'heart-pulse': HeartPulse,
  'utensils': UtensilsCrossed, 'credit-card': CreditCard, 'message-square': MessageSquare,
  'graduation-cap': GraduationCap, 'truck': Truck, 'clipboard-list': ClipboardList, 'gift': Gift,
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} className={`h-3 w-3 ${star <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} />
      ))}
      <span className="text-xs text-slate-400 ml-1">{rating}</span>
    </div>
  );
}

export default function MarketplacePage() {
  const { items, isLoading, error, refetch, installItem, uninstallItem } = useMarketplace();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MarketplaceCategory | 'Todos'>('Todos');

  const filtered = items.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) || item.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'Todos' || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  if (isLoading) return <LoadingSpinner label="Cargando marketplace..." />;

  return (
    <div className="space-y-6">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Templates y extensiones para potenciar tu bot. Instala en un clic y personaliza con tu agente.
      </p>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar templates..." />
        <div className="flex flex-wrap gap-2">
          {(['Todos', ...MARKETPLACE_CATEGORIES] as const).map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                activeCategory === cat ? 'bg-brand-400/10 text-brand-400 border-brand-400/30' : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
              }`}
            >{cat}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => {
          const Icon = iconMap[item.icon] || ShoppingBag;
          return (
            <div key={item.id} className="card-accent flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className="h-10 w-10 rounded-lg bg-brand-400/10 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate">{item.name}</h4>
                  <p className="text-[10px] text-slate-500">por {item.author}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-4 flex-1">{item.description}</p>
              <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                <div className="flex flex-col gap-1">
                  <StarRating rating={item.rating} />
                  <span className="text-[10px] text-slate-500">{item.reviews} reseñas</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${item.price === 'Gratis' ? 'text-emerald-400' : 'text-white'}`}>{item.price}</span>
                  {item.installed ? (
                    <button onClick={() => uninstallItem(item.id)} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-red-400 transition-colors">
                      <Check className="h-3 w-3" /> Instalado
                    </button>
                  ) : (
                    <button onClick={() => installItem(item.id)} className="btn-primary text-xs py-1 px-2.5">
                      <Download className="h-3 w-3" /> Instalar
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <EmptyState icon={Store} title="No hay items" description="No se encontraron templates para esta búsqueda." />
      )}
    </div>
  );
}
