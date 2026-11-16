'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Minus, Search, UserPlus } from 'lucide-react';
import * as ordersApi from '@/lib/api/orders';
import * as productsApi from '@/lib/api/products';
import * as clientsApi from '@/lib/api/clients';
import type { Order, Product, Client } from '@/types';

type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'QR';

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'CASH', label: 'Efectivo' },
  { id: 'CARD', label: 'Tarjeta' },
  { id: 'TRANSFER', label: 'Transferencia' },
  { id: 'QR', label: 'QR / MercadoPago' },
];

interface NewOrderModalProps {
  onClose: () => void;
  onCreated: (order: Order) => void;
}

/**
 * Alta manual de un pedido desde el panel.
 *
 * - Los ítems salen de los productos del negocio; se manda SOLO productId +
 *   cantidad. El precio y el total los fija el servidor (el total que se ve acá
 *   es una estimación).
 * - Cliente: uno existente (búsqueda), uno nuevo con datos mínimos, o sin
 *   cliente (venta de mostrador: el pedido queda a nombre del usuario actual).
 * - Ojo: crear el pedido registra la venta y descuenta stock (igual que desde
 *   cualquier otro canal).
 * - Idempotency-Key estable por modal: un doble click o reintento no duplica.
 */
export function NewOrderModal({ onClose, onCreated }: NewOrderModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productSearch, setProductSearch] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});

  const [clientMode, setClientMode] = useState<'none' | 'existing' | 'new'>('none');
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [idempotencyKey] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  useEffect(() => {
    let cancelled = false;
    productsApi
      .getProducts()
      .then((list) => { if (!cancelled) setProducts((list || []).filter((p) => p.isActive)); })
      .catch(() => { if (!cancelled) setError('No se pudieron cargar los productos'); })
      .finally(() => { if (!cancelled) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, []);

  // Búsqueda de clientes existentes (con una pequeña espera para no pegarle al server en cada tecla).
  useEffect(() => {
    if (clientMode !== 'existing' || clientSearch.trim().length < 2) {
      setClientResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      clientsApi
        .getClients({ search: clientSearch.trim(), pageSize: 8 })
        .then((res) => { if (!cancelled) setClientResults(res.data || []); })
        .catch(() => { if (!cancelled) setClientResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [clientMode, clientSearch]);

  const visibleProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, productSearch]);

  const lines = products
    .filter((p) => (qty[p.id] ?? 0) > 0)
    .map((p) => ({ product: p, quantity: qty[p.id] }));
  const estimatedTotal = lines.reduce((s, l) => s + Number(l.product.price) * l.quantity, 0);

  function change(productId: string, delta: number) {
    setQty((prev) => {
      const next = Math.max(0, Math.min(10000, (prev[productId] ?? 0) + delta));
      return { ...prev, [productId]: next };
    });
  }

  const clientReady =
    clientMode === 'none' ||
    (clientMode === 'existing' && selectedClient !== null) ||
    (clientMode === 'new' && newName.trim().length >= 2 && /.+@.+\..+/.test(newEmail.trim()));
  const canSubmit = lines.length > 0 && clientReady && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      let clientId: string | undefined;
      if (clientMode === 'existing') {
        clientId = selectedClient!.id;
      } else if (clientMode === 'new') {
        const created = await clientsApi.createClient({
          name: newName.trim(),
          email: newEmail.trim(),
          phone: newPhone.trim() || undefined,
        });
        clientId = created.id;
        // Si el pedido falla y se reintenta, no volvemos a crear el cliente.
        setSelectedClient(created);
        setClientMode('existing');
      }
      const order = await ordersApi.createOrder(
        {
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          paymentMethod: method,
          clientId,
          notes: notes.trim() || undefined,
        },
        idempotencyKey
      );
      onCreated(order);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'No se pudo crear la orden. Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nueva orden"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-white">Nueva orden</h3>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 rounded hover:bg-slate-800">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Cliente */}
          <section>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Cliente</p>
            <div className="flex gap-2 mb-2 flex-wrap">
              {([
                ['none', 'Sin cliente (mostrador)'],
                ['existing', 'Cliente existente'],
                ['new', 'Cliente nuevo'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setClientMode(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    clientMode === id
                      ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                      : 'text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {clientMode === 'existing' && (
              <div className="space-y-2">
                {selectedClient ? (
                  <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-white">
                    <span>{selectedClient.name}{selectedClient.phone ? ` · ${selectedClient.phone}` : ''}</span>
                    <button type="button" onClick={() => setSelectedClient(null)} className="text-xs text-slate-400 hover:text-white">
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="Buscar por nombre, email o teléfono..."
                      aria-label="Buscar cliente"
                      className="input w-full"
                    />
                    {clientResults.length > 0 && (
                      <ul className="rounded-lg border border-slate-700/50 divide-y divide-slate-800">
                        {clientResults.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => { setSelectedClient(c); setClientResults([]); }}
                              className="w-full text-left px-3 py-2 text-sm text-white hover:bg-slate-800/60"
                            >
                              {c.name} <span className="text-xs text-slate-500">{c.phone || c.email}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            {clientMode === 'new' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre *" aria-label="Nombre del cliente" className="input w-full" />
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email *" aria-label="Email del cliente" className="input w-full" />
                <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Teléfono" aria-label="Teléfono del cliente" className="input w-full" />
                <p className="sm:col-span-3 text-[10px] text-slate-500 flex items-center gap-1">
                  <UserPlus className="h-3 w-3" /> Se crea el cliente en tu agenda junto con la orden.
                </p>
              </div>
            )}

            {clientMode === 'none' && (
              <p className="text-[10px] text-slate-500">
                La orden queda a tu nombre y no se le avisa a ningún cliente.
              </p>
            )}
          </section>

          {/* Productos */}
          <section>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Productos</p>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Filtrar productos..."
                aria-label="Filtrar productos"
                className="input w-full pl-9"
              />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1">
              {loadingProducts ? (
                <p className="text-xs text-slate-500 py-3 text-center">Cargando productos...</p>
              ) : visibleProducts.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">No hay productos activos</p>
              ) : (
                visibleProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono">${Number(p.price).toLocaleString('es-AR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => change(p.id, -1)} aria-label={`Quitar ${p.name}`} disabled={!(qty[p.id] > 0)}
                        className="p-1 rounded border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-xs font-mono text-white" data-testid={`qty-${p.id}`}>{qty[p.id] ?? 0}</span>
                      <button type="button" onClick={() => change(p.id, 1)} aria-label={`Agregar ${p.name}`}
                        className="p-1 rounded border border-slate-700 text-slate-400 hover:text-white">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Pago y notas */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block" htmlFor="new-order-method">Método de pago</label>
              <select id="new-order-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="input w-full">
                {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block" htmlFor="new-order-notes">Nota interna</label>
              <input id="new-order-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Opcional" className="input w-full" />
            </div>
          </section>

          <p className="text-[10px] text-slate-500">
            Al crear la orden se registra la venta ({METHODS.find((m) => m.id === method)?.label}) y se descuenta el stock.
            El precio final lo calcula el sistema con los precios actuales de tus productos.
          </p>

          {error && (
            <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-700/50">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total estimado</p>
            <p className="text-lg font-bold font-mono text-white">${estimatedTotal.toLocaleString('es-AR')}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancelar</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="btn-primary text-xs disabled:opacity-40">
              {submitting ? 'Creando...' : 'Crear orden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
