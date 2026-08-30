import { Plus, Minus, Trash2 } from 'lucide-react';

export interface CartItemProps {
  item: { name: string; price: number; qty: number };
  onUpdateQty: (name: string, delta: number) => void;
  onRemove: (name: string) => void;
}

export function CartItem({ item, onUpdateQty, onRemove }: CartItemProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface p-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{item.name}</p>
        <p className="text-xs text-slate-500 font-mono">${item.price.toLocaleString('es-AR')}</p>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onUpdateQty(item.name, -1)} className="p-1 rounded hover:bg-surface-100">
          <Minus className="h-3 w-3 text-slate-400" />
        </button>
        <span className="text-sm font-medium text-white w-6 text-center">{item.qty}</span>
        <button onClick={() => onUpdateQty(item.name, 1)} className="p-1 rounded hover:bg-surface-100">
          <Plus className="h-3 w-3 text-slate-400" />
        </button>
      </div>
      <button onClick={() => onRemove(item.name)} className="p-1 rounded hover:bg-surface-100">
        <Trash2 className="h-3 w-3 text-red-400" />
      </button>
    </div>
  );
}
