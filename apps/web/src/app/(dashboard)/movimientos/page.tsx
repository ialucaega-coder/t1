'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight,
  Plus, X, Wallet, CreditCard, Building, QrCode, Clock, Download, ArrowUpDown,
} from 'lucide-react';
import * as transactionsApi from '@/lib/api/transactions';
import type { Transaction } from '@/types';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof ArrowUpRight }> = {
  SALE: { label: 'Venta', color: 'text-emerald-400', icon: ArrowUpRight },
  REFUND: { label: 'Reembolso', color: 'text-red-400', icon: ArrowDownRight },
  PARTIAL: { label: 'Parcial', color: 'text-yellow-400', icon: ArrowUpRight },
};

const PAYMENT_CONFIG: Record<string, { label: string; icon: typeof Wallet }> = {
  CASH: { label: 'Efectivo', icon: Wallet },
  CARD: { label: 'Tarjeta', icon: CreditCard },
  TRANSFER: { label: 'Transferencia', icon: Building },
  QR: { label: 'QR', icon: QrCode },
};

export default function MovimientosPage() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const [newAmount, setNewAmount] = useState('');
  const [newType, setNewType] = useState('SALE');
  const [newMethod, setNewMethod] = useState('CASH');
  const [newReference, setNewReference] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: '25' };
      if (typeFilter) params.type = typeFilter;
      const res = await transactionsApi.getTransactions(params);
      setTransactions(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages ?? 1);
    } catch {
      setError('Error al cargar movimientos');
    } finally {
      setIsLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  async function handleCreate() {
    const amount = parseFloat(newAmount);
    if (!amount || amount <= 0) return;
    setCreating(true);
    try {
      await transactionsApi.createTransaction({
        amount,
        type: newType,
        paymentMethod: newMethod as 'CASH' | 'CARD' | 'TRANSFER' | 'QR',
        reference: newReference || undefined,
        notes: newNotes || undefined,
      });
      setShowCreate(false);
      setNewAmount(''); setNewReference(''); setNewNotes('');
      fetchTransactions();
      toast({ type: 'success', message: 'Movimiento registrado correctamente' });
    } catch {
      setError('Error al registrar movimiento');
      toast({ type: 'error', message: 'Error al registrar el movimiento' });
    } finally {
      setCreating(false);
    }
  }

  const totalSales = transactions.filter((t) => t.type === 'SALE').reduce((s, t) => s + Number(t.amount), 0);
  const totalRefunds = transactions.filter((t) => t.type === 'REFUND').reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={() => { setError(''); fetchTransactions(); }} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Movimientos</h1>
          <p className="text-xs text-slate-500 mt-0.5">{total} transaccion{total !== 1 ? 'es' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => transactionsApi.exportCsv().catch(console.error)}
            className="btn-secondary text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Exportar
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Registrar movimiento
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
          <div className="flex items-center gap-2 text-emerald-400 mb-1">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider">Ventas</span>
          </div>
          <p className="text-lg font-bold font-mono text-white">${totalSales.toLocaleString('es-AR')}</p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
          <div className="flex items-center gap-2 text-red-400 mb-1">
            <ArrowDownRight className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider">Reembolsos</span>
          </div>
          <p className="text-lg font-bold font-mono text-white">${totalRefunds.toLocaleString('es-AR')}</p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
          <div className="flex items-center gap-2 text-brand-400 mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider">Neto</span>
          </div>
          <p className="text-lg font-bold font-mono text-white">${(totalSales - totalRefunds).toLocaleString('es-AR')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {[
          { value: '', label: 'Todos' },
          { value: 'SALE', label: 'Ventas' },
          { value: 'REFUND', label: 'Reembolsos' },
          { value: 'PARTIAL', label: 'Parciales' },
        ].map((opt) => (
          <button key={opt.value}
            onClick={() => { setTypeFilter(opt.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              typeFilter === opt.value
                ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
            }`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="rounded-xl border border-brand-400/30 bg-slate-800/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Nuevo movimiento</h3>
            <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Monto *</label>
              <input type="number" value={newAmount} onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0" min="0" step="100"
                className="input w-full" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Tipo</label>
              <select value={newType} onChange={(e) => setNewType(e.target.value)} className="input w-full">
                <option value="SALE">Venta</option>
                <option value="REFUND">Reembolso</option>
                <option value="PARTIAL">Parcial</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Método de pago</label>
              <select value={newMethod} onChange={(e) => setNewMethod(e.target.value)} className="input w-full">
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="QR">QR</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Referencia</label>
              <input type="text" value={newReference} onChange={(e) => setNewReference(e.target.value)}
                placeholder="Ej: Factura #123"
                className="input w-full" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Notas</label>
            <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Notas opcionales..."
              className="input w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs">Cancelar</button>
            <button onClick={handleCreate} disabled={creating || !newAmount}
              className="btn-primary text-xs disabled:opacity-50">
              {creating ? 'Registrando...' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Transactions list */}
      {isLoading ? (
        <LoadingSpinner label="Cargando movimientos..." />
      ) : transactions.length === 0 ? (
        <EmptyState icon={ArrowUpDown} title="No hay movimientos" description={typeFilter ? 'No hay movimientos con ese filtro' : undefined} />
      ) : (
        <div className="space-y-1.5">
          {transactions.map((tx) => {
            const typeCfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.SALE;
            const paymentCfg = PAYMENT_CONFIG[tx.paymentMethod] || PAYMENT_CONFIG.CASH;
            const TypeIcon = typeCfg.icon;
            const PayIcon = paymentCfg.icon;
            return (
              <div key={tx.id} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3 flex items-center gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                  tx.type === 'REFUND' ? 'bg-red-500/10' : 'bg-emerald-500/10'
                }`}>
                  <TypeIcon className={`h-4 w-4 ${typeCfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{typeCfg.label}</p>
                    {tx.reference && <span className="text-[10px] text-slate-500 font-mono">{tx.reference}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <PayIcon className="h-2.5 w-2.5" /> {paymentCfg.label}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" /> {new Date(tx.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {tx.notes && <span className="truncate max-w-[200px]">{tx.notes}</span>}
                  </div>
                </div>
                <p className={`text-sm font-bold font-mono ${typeCfg.color}`}>
                  {tx.type === 'REFUND' ? '-' : '+'}${Number(tx.amount).toLocaleString('es-AR')}
                </p>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-slate-500">{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white disabled:opacity-30">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
