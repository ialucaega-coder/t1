'use client';

import { useState } from 'react';
import { Star, Bell as BellIcon, Check, Calendar, ShoppingBag, HeartPulse, UtensilsCrossed, CreditCard, MessageSquare, GraduationCap, Truck, ClipboardList, Gift, Store, Bell, QrCode, Heart, MapPin } from 'lucide-react';
import { normalizeText, toKebabCase } from '@/lib/text';
import { useMarketplace } from '@/hooks/use-marketplace';
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from '@/constants/marketplace';
import { SearchInput } from '@/components/ui/SearchInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';

/**
 * Ítems del catálogo cuya instalación TIENE efecto real en el producto. Hoy el server
 * solo guarda una fila "instalado" por negocio (marketplaceInstall) y ninguna otra parte
 * la lee: instalar no activa nada. Por eso ningún ítem figura acá y la pantalla ofrece
 * "Avisarme cuando esté disponible" en vez de "Instalar". Cuando un ítem tenga
 * funcionalidad real, agregarlo a este set (por nombre) para habilitar "Instalar".
 */
const ITEMS_WITH_REAL_EFFECT = new Set<string>();

const iconMap: Record<string, React.ElementType> = {
  'calendar': Calendar, 'shopping-bag': ShoppingBag, 'heart-pulse': HeartPulse,
  'utensils': UtensilsCrossed, 'credit-card': CreditCard, 'message-square': MessageSquare,
  'graduation-cap': GraduationCap, 'truck': Truck, 'clipboard-list': ClipboardList, 'gift': Gift,
  // Íconos que usa el catálogo que siembra el server (vienen en PascalCase: "Bell", "QrCode"…).
  'bell': Bell, 'star': Star, 'qr-code': QrCode, 'heart': Heart, 'map-pin': MapPin,
};

/** Resuelve el ícono de un item aceptando kebab-case ("credit-card") o PascalCase ("CreditCard"). */
function iconFor(name: string): React.ElementType {
  return iconMap[toKebabCase(name)] || ShoppingBag;
}

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
  const [pendingUninstall, setPendingUninstall] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function handleInstall(id: string, name: string) {
    const real = ITEMS_WITH_REAL_EFFECT.has(name);
    try {
      await installItem(id);
      toast({
        type: 'success',
        message: real
          ? `"${name}" instalado correctamente`
          : `Listo: te avisamos cuando "${name}" esté disponible. Todavía no se activa nada en tu cuenta.`,
      });
    } catch (err) {
      const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
      toast({ type: 'error', message: real ? `No se pudo instalar "${name}"${detail}` : `No se pudo registrar tu interés en "${name}"${detail}` });
    }
  }

  async function handleConfirmUninstall() {
    if (!pendingUninstall) return;
    setBusy(true);
    try {
      await uninstallItem(pendingUninstall.id);
      toast({
        type: 'success',
        message: ITEMS_WITH_REAL_EFFECT.has(pendingUninstall.name)
          ? `"${pendingUninstall.name}" desinstalado`
          : `Ya no te avisamos sobre "${pendingUninstall.name}"`,
      });
      setPendingUninstall(null);
    } catch {
      toast({ type: 'error', message: `No se pudo desinstalar "${pendingUninstall.name}"` });
    } finally {
      setBusy(false);
    }
  }

  // Búsqueda y categoría sin distinguir tildes: el seed del server puede traer
  // "Gastronomia"/"Educacion" y el front usa "Gastronomía"/"Educación".
  const filtered = items.filter((item) => {
    const needle = normalizeText(search);
    const matchesSearch = normalizeText(item.name).includes(needle) || normalizeText(item.description).includes(needle);
    const matchesCategory = activeCategory === 'Todos' || normalizeText(item.category) === normalizeText(activeCategory);
    return matchesSearch && matchesCategory;
  });

  if (isLoading) return <LoadingSpinner label="Cargando marketplace..." />;

  return (
    <div className="space-y-6">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Templates y extensiones para potenciar tu bot.
      </p>
      <div role="note" className="max-w-2xl rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-400">
        Estas extensiones todavía no están disponibles: por ahora podés anotarte y te avisamos cuando se habiliten.
        Anotarte no activa nada en tu cuenta ni tiene costo.
      </div>

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
          const Icon = iconFor(item.icon);
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
                  {ITEMS_WITH_REAL_EFFECT.has(item.name) ? (
                    item.installed ? (
                      <button onClick={() => setPendingUninstall({ id: item.id, name: item.name })} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-red-400 transition-colors">
                        <Check className="h-3 w-3" /> Instalado
                      </button>
                    ) : (
                      <button onClick={() => handleInstall(item.id, item.name)} className="btn-primary text-xs py-1 px-2.5">
                        Instalar
                      </button>
                    )
                  ) : item.installed ? (
                    <button onClick={() => setPendingUninstall({ id: item.id, name: item.name })} className="flex items-center gap-1 text-xs text-sky-400 hover:text-red-400 transition-colors">
                      <Check className="h-3 w-3" /> Te avisamos
                    </button>
                  ) : (
                    <button onClick={() => handleInstall(item.id, item.name)} className="btn-secondary text-xs py-1 px-2.5">
                      <BellIcon className="h-3 w-3" /> Próximamente · Avisarme
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

      <ConfirmDialog
        isOpen={pendingUninstall !== null}
        onClose={() => setPendingUninstall(null)}
        onConfirm={handleConfirmUninstall}
        title={ITEMS_WITH_REAL_EFFECT.has(pendingUninstall?.name ?? '') ? '¿Desinstalar template?' : '¿Dejar de recibir el aviso?'}
        message={
          ITEMS_WITH_REAL_EFFECT.has(pendingUninstall?.name ?? '')
            ? `Vas a desinstalar "${pendingUninstall?.name ?? ''}" de tu cuenta. Podés volver a instalarlo cuando quieras.`
            : `Vas a dejar de anotarte en "${pendingUninstall?.name ?? ''}". Podés volver a anotarte cuando quieras.`
        }
        confirmLabel={ITEMS_WITH_REAL_EFFECT.has(pendingUninstall?.name ?? '') ? 'Desinstalar' : 'Dejar de avisar'}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}
