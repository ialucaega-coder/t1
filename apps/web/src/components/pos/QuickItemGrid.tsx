import { type QuickItem } from '@/constants/pos';

export interface QuickItemGridProps {
  items: QuickItem[];
  onAdd: (item: QuickItem) => void;
}

export function QuickItemGrid({ items, onAdd }: QuickItemGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      {items.map((item) => (
        <button
          key={item.name}
          onClick={() => onAdd(item)}
          className="card-accent text-left hover:border-brand-500/70 active:scale-[0.98] transition-all"
        >
          <p className="text-sm font-medium text-white mb-1">{item.name}</p>
          <p className="text-xs text-brand-400 font-mono">${item.price.toLocaleString('es-AR')}</p>
        </button>
      ))}
    </div>
  );
}
