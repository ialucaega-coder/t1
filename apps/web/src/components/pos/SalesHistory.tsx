'use client';

import { useState, useEffect, useCallback } from 'react';
import { httpClient } from '@/lib/api/http-client';
import { Search, Download, Calendar, Filter } from 'lucide-react';

interface Transaction {
  id: string;
  amount: number;
  type: string;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  QR: 'QR',
  OTHER: 'Otro',
};

const METHOD_COLORS: Record<string, string> = {
  CASH: 'bg-green-500/10 text-green-400',
  CARD: 'bg-blue-500/10 text-blue-400',
  TRANSFER: 'bg-purple-500/10 text-purple-400',
  QR: 'bg-amber-500/10 text-amber-400',
};

export function SalesHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (filterMethod) params.set('type', filterMethod);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const res = await httpClient.get<{ data: Transaction[]; totalPages: number }>(`/transactions?${params}`);
      setTransactions(res.data || []);
      setTotalPages(res.totalPages || 1);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterMethod, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const filtered = transactions.filter((t) =>
    !search || (t.notes || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.reference || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalSales = filtered.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por cliente o referencia..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-surface-100 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            value={filterMethod}
            onChange={(e) => { setFilterMethod(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-surface-100 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-brand-400"
          >
            <option value="">Todos los métodos</option>
            <option value="CASH">Efectivo</option>
            <option value="CARD">Tarjeta</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="QR">QR</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-500" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="px-2 py-2 rounded-lg bg-surface-100 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-brand-400"
          />
          <span className="text-slate-500 text-xs">a</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="px-2 py-2 rounded-lg bg-surface-100 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-brand-400"
          />
        </div>
      </div>

      {/* Resumen */}
      <div className="flex gap-4">
        <div className="card flex-1">
          <p className="text-xs text-slate-500 uppercase font-mono">Ventas mostradas</p>
          <p className="text-xl font-bold text-white font-mono">{filtered.length}</p>
        </div>
        <div className="card flex-1">
          <p className="text-xs text-slate-500 uppercase font-mono">Total facturado</p>
          <p className="text-xl font-bold text-green-400 font-mono">${totalSales.toLocaleString('es-AR')}</p>
        </div>
        <div className="card flex-1 flex items-end justify-end">
          <button className="btn-secondary text-xs">
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left text-[10px] text-slate-500 uppercase font-mono tracking-wider py-2 px-3">Fecha</th>
              <th className="text-left text-[10px] text-slate-500 uppercase font-mono tracking-wider py-2 px-3">Hora</th>
              <th className="text-left text-[10px] text-slate-500 uppercase font-mono tracking-wider py-2 px-3">Método</th>
              <th className="text-left text-[10px] text-slate-500 uppercase font-mono tracking-wider py-2 px-3">Cliente</th>
              <th className="text-left text-[10px] text-slate-500 uppercase font-mono tracking-wider py-2 px-3">Referencia</th>
              <th className="text-right text-[10px] text-slate-500 uppercase font-mono tracking-wider py-2 px-3">Monto</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-500">Cargando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-500">Sin ventas registradas</td></tr>
            ) : (
              filtered.map((t) => {
                const d = new Date(t.createdAt);
                return (
                  <tr key={t.id} className="border-b border-slate-800/50 hover:bg-surface-100/30">
                    <td className="py-2.5 px-3 text-slate-300 font-mono text-xs">{d.toLocaleDateString('es-AR')}</td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-xs">{d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase ${METHOD_COLORS[t.paymentMethod] || 'bg-slate-500/10 text-slate-400'}`}>
                        {METHOD_LABELS[t.paymentMethod] || t.paymentMethod}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 text-xs">{t.notes?.replace('Cliente: ', '') || '—'}</td>
                    <td className="py-2.5 px-3 text-slate-500 text-xs font-mono">{t.reference || '—'}</td>
                    <td className="py-2.5 px-3 text-right text-white font-mono font-medium">${Number(t.amount).toLocaleString('es-AR')}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="btn-secondary text-xs disabled:opacity-30"
          >
            Anterior
          </button>
          <span className="text-xs text-slate-400 font-mono">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="btn-secondary text-xs disabled:opacity-30"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
