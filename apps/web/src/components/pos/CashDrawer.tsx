'use client';

import { useState, useEffect, useMemo } from 'react';
import { httpClient } from '@/lib/api/http-client';
import { todayArgentinaKey } from '@/lib/date-range';
import {
  Wallet, Lock, Unlock, Clock, AlertTriangle,
  Plus, Minus, DollarSign, Calculator,
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

type DrawerStatus = 'closed' | 'open' | 'reconciling';

interface CashMovement {
  id: string;
  type: 'OPENING' | 'SALE' | 'REFUND' | 'WITHDRAWAL' | 'DEPOSIT' | 'CLOSING';
  /** Con signo: las devoluciones y retiros son negativos. */
  amount: number;
  notes: string;
  user: string;
  createdAt: string;
  /** Método de cobro de las ventas y devoluciones del sistema (CASH, CARD, TRANSFER, QR). */
  method?: string;
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', QR: 'QR', OTHER: 'Otro',
};

/** Tamaño de página que acepta el server (máx. 100) y tope de páginas por seguridad (3000 movimientos). */
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

/**
 * Pasa un movimiento del sistema (Transaction) al modelo de la caja:
 *  - VENTA y COBRO PARCIAL suman; DEVOLUCIÓN (REFUND) resta.
 *  - Una nota "Retiro"/"Ingreso" en un movimiento que no es venta es un retiro (resta) o
 *    un ingreso de efectivo (suma).
 * Antes todo lo que no era venta se tomaba como venta positiva (una devolución sumaba).
 */
function toCashMovement(t: TransactionRecord): CashMovement {
  const raw = Math.abs(Number(t.amount));
  const notes = t.notes || '';
  const base = { id: t.id, user: t.reference || 'Sistema', createdAt: t.createdAt, method: t.paymentMethod };
  const methodLabel = METHOD_LABELS[t.paymentMethod] ?? t.paymentMethod;

  if (t.type === 'REFUND') {
    return { ...base, type: 'REFUND', amount: -raw, notes: notes || `Devolución · ${methodLabel}` };
  }
  if (t.type !== 'SALE' && t.type !== 'PARTIAL') {
    if (notes.includes('Retiro')) return { ...base, type: 'WITHDRAWAL', amount: -raw, notes };
    if (notes.includes('Ingreso')) return { ...base, type: 'DEPOSIT', amount: raw, notes };
  }
  const label = t.type === 'PARTIAL' ? 'Cobro parcial' : 'Venta';
  return { ...base, type: 'SALE', amount: raw, notes: notes || `${label} · ${methodLabel}` };
}

/** Trae TODOS los movimientos del día paginando (el server acepta máx. 100 por página). */
async function fetchDayTransactions(day: string): Promise<{ rows: TransactionRecord[]; truncated: boolean }> {
  const rows: TransactionRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await httpClient.get<{ data: TransactionRecord[]; totalPages?: number }>(
      `/transactions?from=${day}&to=${day}&page=${page}&pageSize=${PAGE_SIZE}`
    );
    rows.push(...(res.data || []));
    if (page >= (res.totalPages ?? 1)) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Un cobro o devolución que NO es en efectivo no entra al cajón. */
function isNonCash(m: CashMovement): boolean {
  return (m.type === 'SALE' || m.type === 'REFUND') && m.method !== undefined && m.method !== 'CASH';
}

const DENOMINATIONS = [
  { label: '$1000', value: 1000 },
  { label: '$500', value: 500 },
  { label: '$200', value: 200 },
  { label: '$100', value: 100 },
  { label: '$50', value: 50 },
  { label: '$20', value: 20 },
  { label: '$10', value: 10 },
  { label: '$5', value: 5 },
  { label: '$1', value: 1 },
  { label: 'Monedas', value: 0 },
];

export function CashDrawer() {
  const [status, setStatus] = useState<DrawerStatus>('closed');
  const [openingBalance, setOpeningBalance] = useState('');
  // Movimientos que vienen del sistema (ventas del día) y movimientos locales de la
  // caja (apertura, retiros, ingresos, cierre). Separados para que la carga del
  // servidor, que llega async, nunca pise lo que ya se cargó a mano.
  const [serverMovements, setServerMovements] = useState<CashMovement[]>([]);
  const [localMovements, setLocalMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [openedAt, setOpenedAt] = useState<Date | null>(null);

  useEffect(() => {
    loadMovements();
  }, []);

  async function loadMovements() {
    setLoading(true);
    setLoadError(null);
    try {
      // Día de hoy en hora argentina (no UTC): de 21:00 a 24:00 AR el UTC ya es "mañana".
      const { rows, truncated: cut } = await fetchDayTransactions(todayArgentinaKey());
      setServerMovements(rows.map(toCashMovement));
      setTruncated(cut);
    } catch (err) {
      // No mostramos $0 como si fuera el saldo real: avisamos el error y se puede reintentar.
      setServerMovements([]);
      setLoadError(err instanceof Error && err.message ? err.message : 'No se pudieron cargar las ventas de hoy');
    } finally {
      setLoading(false);
    }
  }

  function openDrawer() {
    const amount = Number(openingBalance) || 0;
    setStatus('open');
    setOpenedAt(new Date());
    setLocalMovements((prev) => [{
      id: crypto.randomUUID(),
      type: 'OPENING',
      amount,
      notes: 'Apertura de caja',
      user: 'Cajero',
      createdAt: new Date().toISOString(),
    }, ...prev]);
  }

  function handleWithdraw() {
    const amt = Number(withdrawAmount);
    if (amt <= 0) return;
    setLocalMovements((prev) => [{
      id: crypto.randomUUID(),
      type: 'WITHDRAWAL',
      amount: -amt,
      notes: withdrawNote || 'Retiro de efectivo',
      user: 'Cajero',
      createdAt: new Date().toISOString(),
    }, ...prev]);
    setWithdrawAmount('');
    setWithdrawNote('');
    setShowWithdraw(false);
  }

  function handleDeposit() {
    const amt = Number(depositAmount);
    if (amt <= 0) return;
    setLocalMovements((prev) => [{
      id: crypto.randomUUID(),
      type: 'DEPOSIT',
      amount: amt,
      notes: depositNote || 'Ingreso de efectivo',
      user: 'Cajero',
      createdAt: new Date().toISOString(),
    }, ...prev]);
    setDepositAmount('');
    setDepositNote('');
    setShowDeposit(false);
  }

  function startReconciliation() {
    setCounts({});
    setStatus('reconciling');
  }

  function finishReconciliation() {
    const countedTotal = DENOMINATIONS.reduce((s, d) => s + d.value * (counts[d.value] || 0), 0) + (counts[0] || 0);
    setLocalMovements((prev) => [{
      id: crypto.randomUUID(),
      type: 'CLOSING',
      amount: countedTotal,
      notes: `Cierre de caja — Conteo: $${countedTotal.toLocaleString('es-AR')}`,
      user: 'Cajero',
      createdAt: new Date().toISOString(),
    }, ...prev]);
    setStatus('closed');
    setOpenedAt(null);
    setOpeningBalance('');
  }

  const movements = useMemo(() => [...localMovements, ...serverMovements], [localMovements, serverMovements]);

  // Efectivo esperado en el cajón: apertura + ventas en EFECTIVO - devoluciones en efectivo
  // +/- ingresos y retiros. Los cobros con tarjeta, transferencia o QR no entran al cajón.
  const expectedBalance = movements.reduce((s, m) => s + (isNonCash(m) ? 0 : m.amount), 0);
  const countedTotal = DENOMINATIONS.reduce((s, d) => s + d.value * (counts[d.value] || 0), 0) + (counts[0] || 0);
  const difference = countedTotal - expectedBalance;

  const sales = movements.filter((m) => m.type === 'SALE');
  const salesCount = sales.length;
  const salesTotal = sales.reduce((s, m) => s + m.amount, 0);
  const refundsTotal = movements.filter((m) => m.type === 'REFUND').reduce((s, m) => s + Math.abs(m.amount), 0);
  // Medios que no son efectivo (neto de devoluciones), aparte del cajón.
  const nonCash = movements.filter(isNonCash);
  const nonCashTotal = nonCash.reduce((s, m) => s + m.amount, 0);
  const nonCashByMethod = Object.entries(
    nonCash.reduce<Record<string, number>>((acc, m) => {
      const k = m.method ?? 'OTHER';
      acc[k] = (acc[k] ?? 0) + m.amount;
      return acc;
    }, {})
  );
  const NA = '—';
  const money = (n: number) => `$${n.toLocaleString('es-AR')}`;
  const withdrawals = movements.filter((m) => m.type === 'WITHDRAWAL').reduce((s, m) => s + Math.abs(m.amount), 0);
  const deposits = movements.filter((m) => m.type === 'DEPOSIT').reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-400">
          La caja se guarda solo en este dispositivo: la apertura, los retiros, los ingresos y el cierre no se
          registran en el servidor y se pierden al recargar o cambiar de dispositivo. Las ventas del día sí
          vienen del sistema.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <p className="text-xs text-red-400">
            No se pudieron cargar las ventas de hoy ({loadError}). Los montos del sistema no están disponibles hasta reintentar.
          </p>
          <button onClick={loadMovements} disabled={loading} className="btn-secondary text-xs shrink-0 disabled:opacity-50">
            {loading ? 'Reintentando...' : 'Reintentar'}
          </button>
        </div>
      )}
      {truncated && !loadError && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400">
            Hay más de {PAGE_SIZE * MAX_PAGES} movimientos hoy: el saldo esperado puede estar incompleto.
          </p>
        </div>
      )}

      {/* Estado de caja */}
      <div className="flex gap-4 flex-wrap">
        <div className="card flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 mb-2">
            {status === 'open' ? (
              <Unlock className="h-4 w-4 text-green-400" />
            ) : status === 'reconciling' ? (
              <Calculator className="h-4 w-4 text-amber-400" />
            ) : (
              <Lock className="h-4 w-4 text-slate-500" />
            )}
            <h3 className="mono-label">
              {status === 'open' ? 'CAJA ABIERTA' : status === 'reconciling' ? 'ARQUEO EN CURSO' : 'CAJA CERRADA'}
            </h3>
          </div>
          {openedAt && (
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Clock className="h-3 w-3" />
              Abierta desde {openedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
          <p className="text-2xl font-bold text-white font-mono mt-2">
            {loadError ? NA : money(expectedBalance)}
          </p>
          <p className="text-[10px] text-slate-500 uppercase font-mono">Saldo esperado</p>
          <p className="text-[10px] text-slate-600 mt-1">Solo efectivo: apertura, ventas en efectivo, ingresos y retiros.</p>
        </div>

        <div className="card flex-1 min-w-[150px]">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Ventas hoy</p>
          <p className="text-xl font-bold text-green-400 font-mono">{loadError ? NA : salesCount}</p>
          <p className="text-sm text-slate-400 font-mono">{loadError ? NA : money(salesTotal)}</p>
          <p className="text-[10px] text-slate-600">Todos los medios de pago</p>
        </div>

        <div className="card flex-1 min-w-[150px]">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Otros medios (no efectivo)</p>
          <p className="text-xl font-bold text-purple-400 font-mono">{loadError ? NA : money(nonCashTotal)}</p>
          <p className="text-[10px] text-slate-500">
            {loadError || nonCashByMethod.length === 0
              ? 'No suman al efectivo del cajón'
              : nonCashByMethod.map(([k, v]) => `${METHOD_LABELS[k] ?? k} ${money(v)}`).join(' · ')}
          </p>
        </div>

        <div className="card flex-1 min-w-[150px]">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Devoluciones</p>
          <p className="text-xl font-bold text-orange-400 font-mono">{loadError ? NA : money(refundsTotal)}</p>
        </div>

        <div className="card flex-1 min-w-[150px]">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Retiros</p>
          <p className="text-xl font-bold text-red-400 font-mono">${withdrawals.toLocaleString('es-AR')}</p>
        </div>

        <div className="card flex-1 min-w-[150px]">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Ingresos extra</p>
          <p className="text-xl font-bold text-blue-400 font-mono">${deposits.toLocaleString('es-AR')}</p>
        </div>
      </div>

      {/* Acciones */}
      {status === 'closed' && (
        <div className="card">
          <h4 className="text-sm font-medium text-white mb-3">Abrir caja</h4>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-[10px] text-slate-500 uppercase font-mono block mb-1">Saldo inicial</label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="number"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0"
                  className="w-full pl-8 pr-3 py-2.5 rounded-lg bg-surface border border-slate-700/50 text-white font-mono text-lg text-right focus:outline-none focus:border-brand-400"
                />
              </div>
            </div>
            <button onClick={openDrawer} className="btn-primary py-2.5 px-6">
              <Unlock className="h-4 w-4" /> Abrir
            </button>
          </div>
        </div>
      )}

      {status === 'open' && (
        <div className="flex gap-3">
          <button onClick={() => setShowWithdraw(!showWithdraw)} className="btn-secondary text-xs">
            <Minus className="h-3.5 w-3.5" /> Retiro
          </button>
          <button onClick={() => setShowDeposit(!showDeposit)} className="btn-secondary text-xs">
            <Plus className="h-3.5 w-3.5" /> Ingreso
          </button>
          <div className="flex-1" />
          <button
            onClick={startReconciliation}
            disabled={loading || loadError !== null}
            title={loadError ? 'Reintentá la carga de ventas antes de arquear' : undefined}
            className="btn-primary text-xs disabled:opacity-40"
          >
            <Calculator className="h-3.5 w-3.5" /> Cerrar y arquear
          </button>
        </div>
      )}

      {/* Retiro modal inline */}
      {showWithdraw && status === 'open' && (
        <div className="card border-red-500/20">
          <h4 className="text-sm font-medium text-red-400 mb-2">Retiro de efectivo</h4>
          <div className="flex gap-3">
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Monto"
              className="flex-1 px-3 py-2 rounded-lg bg-surface border border-slate-700/50 text-white font-mono focus:outline-none focus:border-brand-400"
            />
            <input
              type="text"
              value={withdrawNote}
              onChange={(e) => setWithdrawNote(e.target.value)}
              placeholder="Motivo"
              className="flex-1 px-3 py-2 rounded-lg bg-surface border border-slate-700/50 text-white text-sm focus:outline-none focus:border-brand-400"
            />
            <button onClick={handleWithdraw} className="btn-primary text-xs px-4">Confirmar</button>
          </div>
        </div>
      )}

      {/* Depósito modal inline */}
      {showDeposit && status === 'open' && (
        <div className="card border-blue-500/20">
          <h4 className="text-sm font-medium text-blue-400 mb-2">Ingreso de efectivo</h4>
          <div className="flex gap-3">
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Monto"
              className="flex-1 px-3 py-2 rounded-lg bg-surface border border-slate-700/50 text-white font-mono focus:outline-none focus:border-brand-400"
            />
            <input
              type="text"
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
              placeholder="Motivo"
              className="flex-1 px-3 py-2 rounded-lg bg-surface border border-slate-700/50 text-white text-sm focus:outline-none focus:border-brand-400"
            />
            <button onClick={handleDeposit} className="btn-primary text-xs px-4">Confirmar</button>
          </div>
        </div>
      )}

      {/* Pantalla de arqueo */}
      {status === 'reconciling' && (
        <div className="card">
          <h4 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
            <Calculator className="h-4 w-4 text-amber-400" />
            Conteo de efectivo
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            {DENOMINATIONS.map((d) => (
              <div key={d.value} className="bg-surface rounded-lg p-2.5 text-center">
                <p className="text-xs text-slate-400 font-mono mb-1">{d.label}</p>
                <input
                  type="number"
                  min="0"
                  value={counts[d.value] || ''}
                  onChange={(e) => setCounts({ ...counts, [d.value]: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-full text-center px-1 py-1.5 rounded bg-surface-100 border border-slate-700/50 text-white font-mono text-sm focus:outline-none focus:border-brand-400"
                />
                {d.value > 0 && counts[d.value] > 0 && (
                  <p className="text-[10px] text-slate-500 font-mono mt-1">
                    ${(d.value * counts[d.value]).toLocaleString('es-AR')}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Resultado */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-surface rounded-lg p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase font-mono">Contado</p>
              <p className="text-lg font-bold text-white font-mono">${countedTotal.toLocaleString('es-AR')}</p>
            </div>
            <div className="bg-surface rounded-lg p-3 text-center">
              <p className="text-[10px] text-slate-500 uppercase font-mono">Esperado</p>
              <p className="text-lg font-bold text-slate-300 font-mono">${expectedBalance.toLocaleString('es-AR')}</p>
            </div>
            <div className={`bg-surface rounded-lg p-3 text-center ${difference !== 0 ? 'border border-red-500/30' : 'border border-green-500/30'}`}>
              <p className="text-[10px] text-slate-500 uppercase font-mono">Diferencia</p>
              <p className={`text-lg font-bold font-mono ${difference === 0 ? 'text-green-400' : 'text-red-400'}`}>
                {difference >= 0 ? '+' : ''}${difference.toLocaleString('es-AR')}
              </p>
            </div>
          </div>

          {difference !== 0 && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 mb-4">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-400">
                {difference > 0 ? 'Hay un sobrante de efectivo. Verificá si faltó registrar un retiro.' : 'Faltante de efectivo detectado. Revisá los movimientos del turno.'}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStatus('open')} className="btn-secondary text-xs">Cancelar</button>
            <button onClick={finishReconciliation} className="btn-primary text-xs">
              <Lock className="h-3.5 w-3.5" /> Confirmar cierre
            </button>
          </div>
        </div>
      )}

      {/* Movimientos del turno */}
      <div className="card">
        <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-brand-400" />
          Movimientos del turno
        </h4>
        {movements.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">Sin movimientos</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface/50">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    m.type === 'OPENING' ? 'bg-blue-400' :
                    m.type === 'SALE' ? 'bg-green-400' :
                    m.type === 'WITHDRAWAL' ? 'bg-red-400' :
                    m.type === 'REFUND' ? 'bg-orange-400' :
                    m.type === 'DEPOSIT' ? 'bg-purple-400' :
                    'bg-amber-400'
                  }`} />
                  <span className="text-xs text-slate-300">{m.notes}</span>
                  {isNonCash(m) && <span className="text-[9px] text-slate-500 border border-slate-700 rounded px-1">no suma al cajón</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(m.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`text-xs font-mono font-medium ${m.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {m.amount >= 0 ? '+' : '-'}${Math.abs(m.amount).toLocaleString('es-AR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
