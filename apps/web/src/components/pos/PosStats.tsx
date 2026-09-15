'use client';

import { useState, useEffect } from 'react';
import { httpClient } from '@/lib/api/http-client';
import {
  DollarSign, ShoppingCart, TrendingUp, Users,
  Banknote, CreditCard, ArrowRightLeft, QrCode,
  BarChart3,
} from 'lucide-react';

interface TransactionRecord {
  id: string;
  amount: string | number;
  type: string;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  orderId: string | null;
}

interface DailyStats {
  totalSales: number;
  transactionCount: number;
  averageTicket: number;
  uniqueClients: number;
  byMethod: Record<string, { count: number; total: number }>;
  hourly: { hour: number; sales: number; count: number }[];
}

const METHOD_CONFIG: Record<string, { label: string; icon: typeof Banknote; color: string; bar: string }> = {
  CASH: { label: 'Efectivo', icon: Banknote, color: 'text-green-400', bar: 'bg-green-400' },
  CARD: { label: 'Tarjeta', icon: CreditCard, color: 'text-blue-400', bar: 'bg-blue-400' },
  TRANSFER: { label: 'Transferencia', icon: ArrowRightLeft, color: 'text-purple-400', bar: 'bg-purple-400' },
  QR: { label: 'QR', icon: QrCode, color: 'text-amber-400', bar: 'bg-amber-400' },
};

export function PosStats() {
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await httpClient.get<{ data: TransactionRecord[] }>(`/transactions?from=${today}&pageSize=500`);
      const txs: TransactionRecord[] = res.data || [];

      const byMethod: Record<string, { count: number; total: number }> = {};
      const hourBuckets: Record<number, { sales: number; count: number }> = {};
      const clients = new Set<string>();

      for (const t of txs) {
        const amt = Number(t.amount);
        const method = t.paymentMethod || 'OTHER';
        if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
        byMethod[method].count++;
        byMethod[method].total += amt;

        const hour = new Date(t.createdAt).getHours();
        if (!hourBuckets[hour]) hourBuckets[hour] = { sales: 0, count: 0 };
        hourBuckets[hour].sales += amt;
        hourBuckets[hour].count++;

        if (t.notes) {
          const match = t.notes.match(/Cliente:\s*(.+)/);
          if (match) clients.add(match[1].trim());
        }
      }

      const hourly: DailyStats['hourly'] = [];
      for (let h = 8; h <= 22; h++) {
        hourly.push({ hour: h, ...(hourBuckets[h] || { sales: 0, count: 0 }) });
      }

      const totalSales = txs.reduce((s: number, t: TransactionRecord) => s + Number(t.amount), 0);

      setStats({
        totalSales,
        transactionCount: txs.length,
        averageTicket: txs.length > 0 ? totalSales / txs.length : 0,
        uniqueClients: clients.size,
        byMethod,
        hourly,
      });
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-slate-500">Cargando resumen...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-slate-500">No hay datos para mostrar</p>
      </div>
    );
  }

  const maxHourlySales = Math.max(...stats.hourly.map((h) => h.sales), 1);

  return (
    <div className="space-y-4">
      {/* KPIs principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-green-500/10">
              <DollarSign className="h-4 w-4 text-green-400" />
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-mono">Total ventas</p>
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            ${stats.totalSales.toLocaleString('es-AR')}
          </p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <ShoppingCart className="h-4 w-4 text-blue-400" />
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-mono">Transacciones</p>
          </div>
          <p className="text-2xl font-bold text-white font-mono">{stats.transactionCount}</p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-purple-500/10">
              <TrendingUp className="h-4 w-4 text-purple-400" />
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-mono">Ticket promedio</p>
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            ${Math.round(stats.averageTicket).toLocaleString('es-AR')}
          </p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10">
              <Users className="h-4 w-4 text-amber-400" />
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-mono">Clientes únicos</p>
          </div>
          <p className="text-2xl font-bold text-white font-mono">{stats.uniqueClients}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ventas por método */}
        <div className="card">
          <h4 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-brand-400" />
            Ventas por método de pago
          </h4>
          <div className="space-y-3">
            {Object.entries(stats.byMethod).map(([method, data]) => {
              const config = METHOD_CONFIG[method];
              const pct = stats.totalSales > 0 ? (data.total / stats.totalSales) * 100 : 0;
              const Icon = config?.icon || Banknote;
              return (
                <div key={method}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 ${config?.color || 'text-slate-400'}`} />
                      <span className="text-xs text-slate-300">{config?.label || method}</span>
                      <span className="text-[10px] text-slate-500 font-mono">({data.count})</span>
                    </div>
                    <span className="text-xs text-white font-mono font-medium">
                      ${data.total.toLocaleString('es-AR')}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${config?.bar || 'bg-slate-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {Object.keys(stats.byMethod).length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">Sin ventas registradas</p>
            )}
          </div>
        </div>

        {/* Ventas por hora */}
        <div className="card">
          <h4 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand-400" />
            Ventas por hora
          </h4>
          <div className="flex items-end gap-1 h-32">
            {stats.hourly.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className="w-full rounded-t bg-brand-400/60 hover:bg-brand-400 transition-colors relative group min-h-[2px]"
                  style={{ height: `${(h.sales / maxHourlySales) * 100}%` }}
                >
                  {h.sales > 0 && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-surface-100 border border-slate-700/50 rounded px-1.5 py-0.5 text-[9px] text-white font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      ${h.sales.toLocaleString('es-AR')}
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-slate-500 font-mono mt-1">{h.hour}h</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
