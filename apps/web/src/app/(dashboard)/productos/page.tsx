'use client';

import { Plus, Package, Pencil, ShoppingBag } from 'lucide-react';

const mockProducts = [
  { id: '1', name: 'Shampoo Profesional 500ml', price: 8500, stock: 24, category: 'Cuidado capilar', isActive: true },
  { id: '2', name: 'Acondicionador Reparador', price: 7200, stock: 18, category: 'Cuidado capilar', isActive: true },
  { id: '3', name: 'Cera para cabello', price: 4500, stock: 32, category: 'Styling', isActive: true },
  { id: '4', name: 'Aceite de argán', price: 6800, stock: 12, category: 'Tratamientos', isActive: true },
  { id: '5', name: 'Gel fijador fuerte', price: 3200, stock: 45, category: 'Styling', isActive: true },
  { id: '6', name: 'Mascarilla capilar', price: 9500, stock: 0, category: 'Tratamientos', isActive: false },
];

export default function ProductosPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Tu catálogo de productos. Los clientes pueden verlos desde el chat y hacer pedidos.
        </p>
        <button className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo producto
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockProducts.map((product) => (
          <div key={product.id} className={`card-accent ${!product.isActive ? 'opacity-50' : ''}`}>
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
        ))}
      </div>
    </div>
  );
}
