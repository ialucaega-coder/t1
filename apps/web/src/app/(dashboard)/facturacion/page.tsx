'use client';

import { useEffect, useState } from 'react';
import {
  CreditCard,
  Check,
  Zap,
  Crown,
  Building2,
  Loader2,
  FileText,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { httpClient } from '@/lib/api';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';

interface Plan {
  id: string;
  name: string;
  tier: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  maxBots: number;
  maxMessages: number;
  maxContacts: number;
  features: string[];
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan: Plan;
}

interface Invoice {
  id: string;
  number: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
}

const tierIcons: Record<string, typeof Zap> = {
  FREE: Zap,
  STARTER: CreditCard,
  PRO: Crown,
  ENTERPRISE: Building2,
};

const tierColors: Record<string, string> = {
  FREE: 'border-slate-600',
  STARTER: 'border-sky-500',
  PRO: 'border-amber-500',
  ENTERPRISE: 'border-purple-500',
};

const tierBg: Record<string, string> = {
  FREE: 'bg-slate-500/10',
  STARTER: 'bg-sky-500/10',
  PRO: 'bg-amber-500/10',
  ENTERPRISE: 'bg-purple-500/10',
};

export default function FacturacionPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setError(null);
    try {
      const [p, s, i] = await Promise.all([
        httpClient.get<Plan[]>('/billing/plans'),
        httpClient.get<Subscription | null>('/billing/subscription'),
        httpClient.get<Invoice[]>('/billing/invoices'),
      ]);
      setPlans(p);
      setSubscription(s);
      setInvoices(i);
    } catch (err) {
      setError('No se pudieron cargar los datos de facturación. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(planId: string) {
    setSubscribing(planId);
    try {
      const sub = await httpClient.post<Subscription>('/billing/subscribe', {
        planId,
        interval,
      });
      setSubscription(sub);
      const inv = await httpClient.get<Invoice[]>('/billing/invoices');
      setInvoices(inv);
    } catch (err) {
      console.error('Error subscribing:', err);
    } finally {
      setSubscribing(null);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const sub = await httpClient.post<Subscription>('/billing/cancel', {});
      setSubscription(sub);
    } catch (err) {
      console.error('Error cancelling:', err);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <LoadingSpinner label="Cargando facturación..." />;
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Facturación</h1>
        <p className="text-sm text-slate-400 mt-1">
          Gestioná tu plan y revisá el historial de pagos.
        </p>
      </div>

      {error && <ErrorAlert message={error} onRetry={loadData} />}

      {/* Suscripción actual */}
      {subscription && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Plan actual</p>
              <p className="text-lg font-semibold text-white mt-1">
                {subscription.plan.name}
              </p>
              <p className="text-sm text-slate-400">
                Vence el{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString('es-AR')}
              </p>
            </div>
            <div className="text-right">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                  subscription.status === 'ACTIVE'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : subscription.status === 'PAST_DUE'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-red-500/10 text-red-400'
                }`}
              >
                {subscription.status === 'ACTIVE'
                  ? 'Activa'
                  : subscription.status === 'PAST_DUE'
                  ? 'Pago pendiente'
                  : 'Cancelada'}
              </span>
              {subscription.cancelAtPeriodEnd && (
                <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Se cancela al final del período
                </p>
              )}
            </div>
          </div>
          {subscription.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="mt-4 text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {cancelling ? 'Cancelando...' : 'Cancelar suscripción'}
            </button>
          )}
        </div>
      )}

      {/* Intervalo toggle */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setInterval('monthly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            interval === 'monthly'
              ? 'bg-sky-500 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Mensual
        </button>
        <button
          onClick={() => setInterval('yearly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            interval === 'yearly'
              ? 'bg-sky-500 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Anual
          <span className="ml-1.5 text-xs opacity-75">-20%</span>
        </button>
      </div>

      {/* Planes */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const Icon = tierIcons[plan.tier] || Zap;
          const isCurrentPlan = subscription?.plan.id === plan.id;
          const price =
            interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;

          return (
            <div
              key={plan.id}
              className={`relative rounded-xl border ${
                isCurrentPlan
                  ? tierColors[plan.tier] + ' border-2'
                  : 'border-slate-700'
              } bg-slate-800/50 p-6 flex flex-col`}
            >
              {isCurrentPlan && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-sky-500 text-white text-xs font-medium rounded-full">
                  Plan actual
                </span>
              )}
              <div
                className={`w-10 h-10 rounded-lg ${
                  tierBg[plan.tier]
                } flex items-center justify-center mb-4`}
              >
                <Icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <div className="mt-2">
                <span className="text-3xl font-bold text-white">
                  ${price.toLocaleString()}
                </span>
                <span className="text-sm text-slate-400">
                  /{interval === 'yearly' ? 'año' : 'mes'}
                </span>
              </div>
              <ul className="mt-4 space-y-2 flex-1">
                <li className="text-sm text-slate-300 flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  {plan.maxBots} bot{plan.maxBots > 1 ? 's' : ''}
                </li>
                <li className="text-sm text-slate-300 flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  {plan.maxMessages.toLocaleString()} mensajes/mes
                </li>
                <li className="text-sm text-slate-300 flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  {plan.maxContacts.toLocaleString()} contactos
                </li>
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className="text-sm text-slate-300 flex items-start gap-2"
                  >
                    <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={isCurrentPlan || subscribing !== null}
                className={`mt-6 w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isCurrentPlan
                    ? 'bg-slate-700 text-slate-400 cursor-default'
                    : 'bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50'
                }`}
              >
                {subscribing === plan.id ? (
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                ) : isCurrentPlan ? (
                  'Plan actual'
                ) : subscription ? (
                  'Cambiar plan'
                ) : (
                  'Elegir plan'
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Historial de facturas */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Historial de facturas
          </h2>
        </div>
        {invoices.length === 0 ? (
          <EmptyState icon={FileText} title="No hay facturas" description="No hay facturas aún" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="px-6 py-3 font-medium">N.°</th>
                  <th className="px-6 py-3 font-medium">Descripción</th>
                  <th className="px-6 py-3 font-medium">Monto</th>
                  <th className="px-6 py-3 font-medium">Estado</th>
                  <th className="px-6 py-3 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/20"
                  >
                    <td className="px-6 py-3 text-slate-300 font-mono text-xs">
                      {inv.number}
                    </td>
                    <td className="px-6 py-3 text-slate-300">
                      {inv.description || '-'}
                    </td>
                    <td className="px-6 py-3 text-white font-medium">
                      ${inv.amount.toLocaleString()} {inv.currency}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          inv.status === 'PAID'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : inv.status === 'PENDING'
                            ? 'bg-amber-500/10 text-amber-400'
                            : inv.status === 'OVERDUE'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {inv.status === 'PAID' && <Check className="h-3 w-3" />}
                        {inv.status === 'OVERDUE' && (
                          <XCircle className="h-3 w-3" />
                        )}
                        {inv.status === 'PAID'
                          ? 'Pagada'
                          : inv.status === 'PENDING'
                          ? 'Pendiente'
                          : inv.status === 'OVERDUE'
                          ? 'Vencida'
                          : inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-400">
                      {new Date(inv.createdAt).toLocaleDateString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
