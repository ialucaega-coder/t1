import { Package, Pencil, ShoppingBag } from 'lucide-react';
import { type Product } from '@/constants/products';

export interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <div className={`card-accent ${!product.isActive ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-center h-32 rounded-lg bg-surface mb-3">
        <ShoppingBag className="h-10 w-10 text-slate-700" />
      </div>
      <h3 className="font-semibold text-white mb-1">{product.name}</h3>
      <p className="mono-label mb-2">{product.category}</p>
      <div className="flex items-center justify-between text-sm">
        <span className="text-white font-medium">${product.price.toLocaleString('es-AR')}</span>
        <span className={`flex items-center gap-1 text-xs ${
          product.stock === 0 ? 'text-red-400' : product.stock < 15 ? 'text-yellow-400' : 'text-slate-400'
        }`}>
          <Package className="h-3 w-3" />
          {product.stock === 0 ? 'Sin stock' : `${product.stock} uds`}
        </span>
      </div>
      <button className="btn-secondary text-xs py-1 px-2 mt-3 w-full">
        <Pencil className="h-3 w-3" /> Editar producto
      </button>
    </div>
  );
}
