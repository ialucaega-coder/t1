'use client';

import { useState } from 'react';
import { Building2, Users, Bot, DollarSign, Plus, Copy, Check, Eye, Settings, BarChart3, Link2, Pencil, Trash2, X } from 'lucide-react';
import { useAgency } from '@/hooks/use-agency';
import { AGENCY_STATS } from '@/constants/agency';
import type { AgencyClient } from '@/constants/agency';
import { SearchInput } from '@/components/ui/SearchInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { usePageCounter, fmtCounter } from '@/stores/page-counter';

const PLAN_OPTIONS: AgencyClient['plan'][] = ['Free', 'Local B+'];
const STATUS_OPTIONS: { value: AgencyClient['status']; label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'trial', label: 'Trial' },
  { value: 'inactive', label: 'Inactivo' },
];

export default function AgenciaPage() {
  const { stats, clients, isLoading, error, refetch, createClient, updateClient, deleteClient } = useAgency();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  // Alta/edición de negocio (antes el botón "Agregar negocio" no hacía nada).
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AgencyClient | null>(null);
  const [formName, setFormName] = useState('');
  const [formPlan, setFormPlan] = useState<AgencyClient['plan']>('Free');
  const [formStatus, setFormStatus] = useState<AgencyClient['status']>('trial');
  const [submitting, setSubmitting] = useState(false);
  const [toDelete, setToDelete] = useState<AgencyClient | null>(null);
  const [deleting, setDeleting] = useState(false);

  usePageCounter(isLoading ? null : fmtCounter(clients.length, 'NEGOCIO', 'NEGOCIOS'));

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormPlan('Free');
    setFormStatus('trial');
    setShowForm(true);
  }

  function openEdit(client: AgencyClient) {
    setEditing(client);
    setFormName(client.name);
    setFormPlan(client.plan);
    setFormStatus(client.status);
    setShowForm(true);
  }

  async function handleSubmit() {
    const name = formName.trim();
    if (!name) {
      toast({ type: 'error', message: 'El nombre del negocio es obligatorio' });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateClient(editing.id, { name, plan: formPlan, status: formStatus });
        toast({ type: 'success', message: 'Negocio actualizado' });
      } else {
        await createClient({ name, plan: formPlan, status: formStatus });
        toast({ type: 'success', message: 'Negocio agregado' });
      }
      setShowForm(false);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo guardar el negocio' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteClient(toDelete.id);
      toast({ type: 'success', message: 'Negocio eliminado' });
      setToDelete(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo eliminar' });
    } finally {
      setDeleting(false);
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(stats.referralLink || AGENCY_STATS.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statCards = [
    { label: 'Negocios', value: stats.totalBusinesses, icon: Building2 },
    { label: 'Bots activos', value: stats.totalBots, icon: Bot },
    { label: 'Ingresos recurrentes', value: stats.totalRevenue, icon: DollarSign },
    { label: 'Clientes activos', value: stats.activeClients, icon: Users },
  ];

  const features = [
    { icon: Eye, title: 'Prospecta con ROI y demo en vivo', description: 'Muéstrale al prospecto cómo funcionaría su bot antes de cerrar.' },
    { icon: DollarSign, title: 'Monta, cotiza y propon con tu marca', description: 'Propuestas white-label con tu logo y colores.' },
    { icon: Settings, title: 'Configura, enciende superpoderes y cobra', description: 'Todo desde un solo panel, sin cambiar de cuenta.' },
    { icon: BarChart3, title: 'Retén con reporte de valor mensual', description: 'Cada cliente recibe un reporte automático de lo que su bot hizo.' },
  ];

  if (isLoading) return <LoadingSpinner label="Cargando agencia..." />;

  return (
    <div className="space-y-8">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Convierte tus bots en un negocio: administra a cada cliente en un solo lugar,
        y cotiza, propon y cóbrale sin salir de aquí.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card-accent">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-brand-400/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-brand-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="text-xs text-slate-400">{stat.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.title} className="card-accent">
              <Icon className="h-5 w-5 text-brand-400 mb-3" />
              <h4 className="text-sm font-semibold text-white mb-1">{feature.title}</h4>
              <p className="text-xs text-slate-400">{feature.description}</p>
            </div>
          );
        })}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-label">TUS CLIENTES</h3>
          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar negocio..." className="max-w-[220px]" />
            <button onClick={openCreate} className="btn-primary text-xs">
              <Plus className="h-3.5 w-3.5" /> Agregar negocio
            </button>
          </div>
        </div>

        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Cliente</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Plan</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Bots</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Estado</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Ingreso</th>
                <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">Actividad</th>
                <th className="px-4 py-3 text-right text-[10px] font-mono uppercase tracking-wider text-slate-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id} className="border-b border-slate-700/30 hover:bg-surface-100 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-brand-400/20 flex items-center justify-center text-xs font-bold text-brand-400">
                        {client.name.split(' ').slice(-1)[0][0]}
                      </div>
                      <span className="text-sm font-medium text-white">{client.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={client.plan === 'Local B+' ? 'premium' : 'inactive'}>{client.plan}</StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{client.bots}</td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={client.status === 'active' ? 'active' : client.status === 'trial' ? 'warning' : 'inactive'}>
                      {client.status === 'active' ? 'ACTIVO' : client.status === 'trial' ? 'TRIAL' : 'INACTIVO'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-300">{client.revenue}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{client.lastActivity}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(client)}
                        className="rounded-lg p-1.5 text-slate-500 hover:text-white hover:bg-surface-100 transition-colors"
                        title="Editar negocio"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setToDelete(client)}
                        className="rounded-lg p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Eliminar negocio"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No se encontraron negocios</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-accent">
        <div className="flex items-center gap-3 mb-4">
          <Link2 className="h-5 w-5 text-brand-400" />
          <div>
            <p className="text-sm text-white font-medium">Link de referido</p>
            <p className="text-xs text-slate-400">Comparte tu link y gana {stats.commission || AGENCY_STATS.commission} de comisión por cada cliente que se registre.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-surface rounded-lg px-4 py-2.5 border border-slate-700">
            <code className="text-sm text-slate-300 font-mono">{stats.referralLink || AGENCY_STATS.referralLink}</code>
          </div>
          <button onClick={handleCopy} className="btn-secondary text-xs">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* Modal alta/edición de negocio */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={submitting ? undefined : () => setShowForm(false)} />
          <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">{editing ? 'Editar negocio' : 'Agregar negocio'}</h2>
              <button onClick={() => setShowForm(false)} disabled={submitting} className="rounded-lg p-1 text-slate-500 hover:text-white hover:bg-surface-100 transition-colors disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nombre del negocio</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="Ej: Barbería Don Juan"
                  autoFocus
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Plan</label>
                  <select value={formPlan} onChange={(e) => setFormPlan(e.target.value as AgencyClient['plan'])} className="input">
                    {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Estado</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as AgencyClient['status'])} className="input">
                    {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} disabled={submitting} className="btn-secondary text-xs disabled:opacity-50">Cancelar</button>
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-xs disabled:opacity-50">
                {submitting ? 'Guardando...' : editing ? 'Guardar cambios' : 'Agregar negocio'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Eliminar negocio"
        message={toDelete ? `¿Seguro que querés eliminar "${toDelete.name}"? Esta acción no se puede deshacer.` : ''}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
