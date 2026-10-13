'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Workflow,
  Plus,
  Trash2,
  X,
  Loader2,
  Zap,
  ArrowRight,
  Filter,
  Play,
  AlertTriangle,
} from 'lucide-react';
import * as workflowsApi from '@/lib/api/workflows';
import type { WorkflowRule, CatalogItem, RunWorkflowResponse, ActionResult } from '@/lib/api/workflows';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';

interface RuleForm {
  nombre: string;
  trigger: string;
  condicion: string;
  accion: string;
}

const emptyForm: RuleForm = { nombre: '', trigger: '', condicion: '', accion: '' };

/** Diccionario key→label a partir del catálogo (para pintar las tarjetas). */
function labelMap(items: CatalogItem[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.key, i.label]));
}

/** Clases + etiqueta del badge según el estado de ejecución de una acción. */
function statusBadge(status: ActionResult['status']): { label: string; cls: string } {
  switch (status) {
    case 'ejecutado':
      return { label: 'Ejecutado', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    case 'simulado':
      return { label: 'Simulado', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' };
    case 'omitido':
      return { label: 'Omitido', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    case 'no_soportado':
      return { label: 'No soportado', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
    case 'error':
      return { label: 'Error', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
    default:
      return { label: status, cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  }
}

export default function WorkflowsPage() {
  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [triggers, setTriggers] = useState<CatalogItem[]>([]);
  const [actions, setActions] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  // Panel "Probar automatización"
  const [testTrigger, setTestTrigger] = useState('');
  const [testLive, setTestLive] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RunWorkflowResponse | null>(null);
  // Ajuste: automatizaciones automáticas en vivo (del pipeline)
  const [automationLive, setAutomationLive] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const { toast } = useToast();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [data, settings] = await Promise.all([
        workflowsApi.list(),
        workflowsApi.getSettings().catch(() => ({ live: false })),
      ]);
      setRules(data.rules);
      setTriggers(data.triggers);
      setActions(data.actions);
      setAutomationLive(settings.live);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las automatizaciones');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const triggerLabels = labelMap(triggers);
  const actionLabels = labelMap(actions);

  function openCreate() {
    setForm({
      ...emptyForm,
      trigger: triggers[0]?.key ?? '',
      accion: actions[0]?.key ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.nombre.trim() || !form.trigger || !form.accion) return;
    setSaving(true);
    try {
      const rule = await workflowsApi.create({
        nombre: form.nombre.trim(),
        trigger: form.trigger,
        accion: form.accion,
        condicion: form.condicion.trim() || undefined,
      });
      setRules((prev) => [...prev, rule]);
      toast({ type: 'success', message: 'Automatización creada correctamente' });
      setShowModal(false);
    } catch {
      toast({ type: 'error', message: 'Error al crear la automatización' });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: WorkflowRule) {
    setToggling(rule.id);
    try {
      const updated = await workflowsApi.update(rule.id, { activo: !rule.activo });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch {
      toast({ type: 'error', message: 'Error al cambiar el estado' });
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await workflowsApi.remove(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast({ type: 'success', message: 'Automatización eliminada' });
    } catch {
      toast({ type: 'error', message: 'Error al eliminar la automatización' });
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleAutomation() {
    const next = !automationLive;
    setSavingSettings(true);
    try {
      const res = await workflowsApi.setSettings(next);
      setAutomationLive(res.live);
      toast({
        type: res.live ? 'success' : 'info',
        message: res.live
          ? 'Automatizaciones EN VIVO: las reglas ahora efectúan acciones reales.'
          : 'Automatizaciones en simulación: las acciones externas no se envían.',
      });
    } catch {
      toast({ type: 'error', message: 'No se pudo cambiar el modo (¿sos admin?)' });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleRun() {
    const trigger = testTrigger || triggers[0]?.key;
    if (!trigger) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await workflowsApi.runWorkflow(trigger, { execute: testLive });
      setTestResult(res);
      if (res.matched === 0) {
        toast({ type: 'info', message: 'Ninguna regla activa coincide con ese disparador' });
      }
    } catch {
      toast({ type: 'error', message: 'Error al probar la automatización' });
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) {
    return <LoadingSpinner label="Cargando automatizaciones..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Automatizaciones</h1>
          <p className="text-sm text-slate-400 mt-1">
            Creá reglas del tipo <span className="text-slate-300">cuando pasa algo → hacé algo</span>.
            Activá o desactivá cada una cuando quieras.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva regla
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {/* Modo de ejecución automática */}
      <div
        className={`flex items-start justify-between gap-4 rounded-xl border p-4 ${
          automationLive
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-slate-700 bg-slate-800/50'
        }`}
      >
        <div className="flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            {automationLive ? (
              <Zap className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-slate-400" />
            )}
            Ejecución automática: {automationLive ? 'EN VIVO' : 'Simulación'}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {automationLive
              ? 'Cuando pasa un evento (reserva, lead, mensaje, pago), las reglas efectúan acciones reales, incluido enviar WhatsApp a tus clientes.'
              : 'Cuando pasa un evento, las reglas corren en simulación: las acciones internas (mover etapa, notificar) se ejecutan, las externas (enviar WhatsApp) NO se envían. Activá "en vivo" cuando quieras que efectúen de verdad.'}
          </p>
        </div>
        <button
          onClick={handleToggleAutomation}
          disabled={savingSettings}
          aria-label={automationLive ? 'Desactivar ejecución en vivo' : 'Activar ejecución en vivo'}
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            automationLive ? 'bg-emerald-500' : 'bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              automationLive ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No hay automatizaciones"
          description="Creá tu primera regla para que la plataforma trabaje por vos ante cada evento."
          action={{ label: 'Crear regla', onClick: openCreate }}
        />
      ) : (
        <div className="grid gap-4">
          {rules.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold text-white truncate">{r.nombre}</h3>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      r.activo
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}
                  >
                    {r.activo ? 'Activa' : 'Pausada'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 rounded-md bg-slate-700/60 px-2 py-1">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    {triggerLabels[r.trigger] || r.trigger}
                  </span>
                  {r.condicion && (
                    <span className="flex items-center gap-1.5 rounded-md bg-slate-700/60 px-2 py-1">
                      <Filter className="h-3.5 w-3.5 text-sky-400" />
                      {r.condicion}
                    </span>
                  )}
                  <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                  <span className="flex items-center gap-1.5 rounded-md bg-slate-700/60 px-2 py-1">
                    <Workflow className="h-3.5 w-3.5 text-purple-400" />
                    {actionLabels[r.accion] || r.accion}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {/* Toggle activo/pausada */}
                <button
                  onClick={() => handleToggle(r)}
                  disabled={toggling === r.id}
                  aria-label={r.activo ? 'Pausar regla' : 'Activar regla'}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                    r.activo ? 'bg-emerald-500' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      r.activo ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  disabled={deleting === r.id}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  {deleting === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Probar automatización */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Play className="h-4 w-4 text-sky-400" />
          <h2 className="font-semibold text-white">Probar automatización</h2>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Elegí un disparador y probá qué harían tus reglas activas. Por defecto es una{' '}
          <span className="text-slate-300">simulación</span>: las acciones internas (mover etapa,
          notificar al equipo) se ejecutan, y las externas (enviar WhatsApp) solo se simulan.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300 mb-1">Disparador</label>
            <select
              value={testTrigger || triggers[0]?.key || ''}
              onChange={(e) => setTestTrigger(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              {triggers.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={testing || triggers.length === 0}
            className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Probar
          </button>
        </div>

        <label className="mt-3 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={testLive}
            onChange={(e) => setTestLive(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
          />
          <span className="text-sm text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Ejecutar en vivo
            </span>{' '}
            <span className="text-slate-400">— envía mensajes reales (WhatsApp) a los clientes.</span>
          </span>
        </label>

        {testResult && (
          <div className="mt-5 border-t border-slate-700 pt-4">
            <div className="flex items-center gap-2 mb-3 text-sm">
              <span className="text-slate-300">
                {testResult.matched} regla{testResult.matched === 1 ? '' : 's'} coincidente
                {testResult.matched === 1 ? '' : 's'}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                  testResult.mode === 'live'
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                }`}
              >
                {testResult.mode === 'live' ? 'En vivo' : 'Simulación'}
              </span>
            </div>

            {testResult.results.length === 0 ? (
              <p className="text-sm text-slate-500">
                No hay reglas activas para este disparador. Creá una (o activala) y volvé a probar.
              </p>
            ) : (
              <div className="space-y-2">
                {testResult.results.map((item) => {
                  const badge = statusBadge(item.result.status);
                  return (
                    <div
                      key={item.ruleId}
                      className="flex items-start justify-between gap-3 rounded-lg bg-slate-700/40 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white truncate">{item.nombre}</span>
                          <span className="text-xs text-slate-500">
                            {actionLabels[item.accion] || item.accion}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{item.result.detail}</p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal crear */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">Nueva automatización</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Saludar a cada lead nuevo"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Cuando pase (disparador)
                </label>
                <select
                  value={form.trigger}
                  onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                >
                  {triggers.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Condición <span className="text-slate-500">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.condicion}
                  onChange={(e) => setForm({ ...form, condicion: e.target.value })}
                  placeholder="Ej: monto > 1000"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Texto libre que describe cuándo aplicar la regla. Se evaluará cuando se cablee la ejecución.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Hacé (acción)
                </label>
                <select
                  value={form.accion}
                  onChange={(e) => setForm({ ...form, accion: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                >
                  {actions.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.nombre.trim() || !form.trigger || !form.accion}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
