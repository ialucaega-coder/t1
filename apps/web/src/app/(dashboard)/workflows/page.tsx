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
  Pencil,
} from 'lucide-react';
import * as workflowsApi from '@/lib/api/workflows';
import type {
  WorkflowRule,
  CatalogItem,
  RunWorkflowResponse,
  ActionResult,
  TemplateVariable,
} from '@/lib/api/workflows';
import { validateParams, cleanParams } from '@/lib/workflows-params';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

interface RuleForm {
  nombre: string;
  trigger: string;
  condicion: string;
  accion: string;
  /** Valores de los campos de la acción elegida (clave del campo → texto). */
  params: Record<string, string>;
}

const emptyForm: RuleForm = { nombre: '', trigger: '', condicion: '', accion: '', params: {} };

const inputCls =
  'w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none';

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
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  // id de la regla que se está editando (null = regla nueva)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<{ id: string; nombre: string } | null>(null);
  // Panel "Probar automatización"
  const [testTrigger, setTestTrigger] = useState('');
  const [testLive, setTestLive] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RunWorkflowResponse | null>(null);
  // Ajuste: automatizaciones automáticas en vivo (del pipeline)
  const [automationLive, setAutomationLive] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  // Confirmaciones explícitas antes de habilitar acciones reales
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmLiveTest, setConfirmLiveTest] = useState(false);
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
      setVariables(data.variables ?? []);
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

  // Campos configurables de la acción elegida en el formulario
  const actionFields = actions.find((a) => a.key === form.accion)?.params ?? [];
  const paramErrors = validateParams(actionFields, form.params, variables);
  const formInvalid =
    !form.nombre.trim() || !form.trigger || !form.accion || Object.keys(paramErrors).length > 0;

  function openCreate() {
    setEditingId(null);
    setSubmitted(false);
    setForm({
      ...emptyForm,
      trigger: triggers[0]?.key ?? '',
      accion: actions[0]?.key ?? '',
    });
    setShowModal(true);
  }

  function openEdit(rule: WorkflowRule) {
    setEditingId(rule.id);
    setSubmitted(false);
    setForm({
      nombre: rule.nombre,
      trigger: rule.trigger,
      condicion: rule.condicion ?? '',
      accion: rule.accion,
      params: { ...(rule.params ?? {}) },
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
  }

  function setParam(key: string, value: string) {
    setForm((f) => ({ ...f, params: { ...f.params, [key]: value } }));
  }

  async function handleSave() {
    setSubmitted(true);
    if (formInvalid) return;
    setSaving(true);
    const params = cleanParams(actionFields, form.params);
    try {
      if (editingId) {
        const updated = await workflowsApi.update(editingId, {
          nombre: form.nombre.trim(),
          trigger: form.trigger,
          accion: form.accion,
          // string vacío = borrar la condición
          condicion: form.condicion.trim(),
          params,
        });
        setRules((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
        toast({ type: 'success', message: 'Automatización actualizada' });
      } else {
        const rule = await workflowsApi.create({
          nombre: form.nombre.trim(),
          trigger: form.trigger,
          accion: form.accion,
          condicion: form.condicion.trim() || undefined,
          params,
        });
        setRules((prev) => [...prev, rule]);
        toast({ type: 'success', message: 'Automatización creada correctamente' });
      }
      closeModal();
    } catch (err) {
      const detail =
        err instanceof Error && err.message && err.message !== 'Validation failed' ? `: ${err.message}` : '';
      toast({
        type: 'error',
        message: `${editingId ? 'Error al guardar los cambios' : 'Error al crear la automatización'}${detail}`,
      });
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
      setRuleToDelete(null);
    }
  }

  // Activar EN VIVO manda mensajes reales a los clientes: pide confirmación
  // explícita. Volver a simulación es seguro y se aplica directo.
  function handleToggleAutomation() {
    if (automationLive) {
      void applyAutomationMode(false);
    } else {
      setConfirmLive(true);
    }
  }

  async function applyAutomationMode(next: boolean) {
    setConfirmLive(false);
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

  // Probar en vivo también manda mensajes reales: misma confirmación.
  function handleRunClick() {
    if (testLive) {
      setConfirmLiveTest(true);
    } else {
      void handleRun();
    }
  }

  async function handleRun() {
    setConfirmLiveTest(false);
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
                {r.params?.texto && (
                  <p className="mt-2 text-xs text-slate-400 line-clamp-2 whitespace-pre-line">
                    <span className="text-slate-500">Texto: </span>
                    {r.params.texto}
                  </p>
                )}
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
                  onClick={() => openEdit(r)}
                  aria-label="Editar regla"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setRuleToDelete({ id: r.id, nombre: r.nombre })}
                  disabled={deleting === r.id}
                  aria-label="Eliminar regla"
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
            onClick={handleRunClick}
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

      {/* Modal crear / editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Editar automatización' : 'Nueva automatización'}
            className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-6 my-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Editar automatización' : 'Nueva automatización'}
              </h2>
              <button
                onClick={closeModal}
                aria-label="Cerrar"
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="rule-nombre" className="block text-sm font-medium text-slate-300 mb-1">
                  Nombre
                </label>
                <input
                  id="rule-nombre"
                  type="text"
                  value={form.nombre}
                  maxLength={120}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Saludar a cada lead nuevo"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="rule-trigger" className="block text-sm font-medium text-slate-300 mb-1">
                  Cuando pase (disparador)
                </label>
                <select
                  id="rule-trigger"
                  value={form.trigger}
                  onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                  className={inputCls}
                >
                  {triggers.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rule-condicion" className="block text-sm font-medium text-slate-300 mb-1">
                  Condición <span className="text-slate-500">(opcional)</span>
                </label>
                <input
                  id="rule-condicion"
                  type="text"
                  value={form.condicion}
                  maxLength={500}
                  onChange={(e) => setForm({ ...form, condicion: e.target.value })}
                  placeholder="Ej: monto > 1000"
                  className={inputCls}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Formato <span className="text-slate-400">campo operador valor</span> (ej:{' '}
                  <span className="text-slate-400">monto &gt; 1000</span>,{' '}
                  <span className="text-slate-400">canal = whatsapp</span>). Operadores: = ≠ &gt; ≥ &lt; ≤ y
                  &ldquo;contiene&rdquo;. Si la dejás vacía, la regla aplica siempre.
                </p>
              </div>
              <div>
                <label htmlFor="rule-accion" className="block text-sm font-medium text-slate-300 mb-1">
                  Hacé (acción)
                </label>
                <select
                  id="rule-accion"
                  value={form.accion}
                  // Los parámetros dependen de la acción: al cambiarla se reinician.
                  onChange={(e) => setForm({ ...form, accion: e.target.value, params: {} })}
                  className={inputCls}
                >
                  {actions.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Campos propios de la acción elegida */}
              {actionFields.map((f) => {
                const id = `rule-param-${f.key}`;
                const err = submitted ? paramErrors[f.key] : undefined;
                const value = form.params[f.key] ?? '';
                return (
                  <div key={f.key}>
                    <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">
                      {f.label}
                      {!f.required && <span className="text-slate-500"> (opcional)</span>}
                    </label>
                    {f.type === 'select' ? (
                      <select
                        id={id}
                        value={value}
                        onChange={(e) => setParam(f.key, e.target.value)}
                        aria-invalid={err ? true : undefined}
                        className={inputCls}
                      >
                        <option value="">Elegí una opción…</option>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === 'textarea' ? (
                      <textarea
                        id={id}
                        rows={4}
                        value={value}
                        maxLength={f.maxLength}
                        onChange={(e) => setParam(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        aria-invalid={err ? true : undefined}
                        className={inputCls}
                      />
                    ) : (
                      <input
                        id={id}
                        type="text"
                        value={value}
                        maxLength={f.maxLength}
                        onChange={(e) => setParam(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        aria-invalid={err ? true : undefined}
                        className={inputCls}
                      />
                    )}
                    {err && (
                      <p role="alert" className="text-[11px] text-red-400 mt-1">
                        {err}
                      </p>
                    )}
                    {f.help && <p className="text-[11px] text-slate-500 mt-1">{f.help}</p>}
                    {f.template && variables.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {variables.map((v) => (
                          <button
                            key={v.key}
                            type="button"
                            title={`${v.label} (ej: ${v.example})`}
                            onClick={() => setParam(f.key, `${value}{{${v.key}}}`)}
                            className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-600"
                          >
                            {`{{${v.key}}}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
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
                {editingId ? 'Guardar cambios' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmLive}
        onClose={() => setConfirmLive(false)}
        onConfirm={() => void applyAutomationMode(true)}
        title="¿Activar la ejecución EN VIVO?"
        message="Desde ahora, cada vez que pase un evento (reserva, lead, mensaje, pago), tus reglas van a ejecutar acciones reales: se envían WhatsApp a tus clientes y no se pueden deshacer. Podés volver a simulación cuando quieras."
        confirmLabel="Sí, activar en vivo"
        variant="warning"
        loading={savingSettings}
      />

      <ConfirmDialog
        isOpen={confirmLiveTest}
        onClose={() => setConfirmLiveTest(false)}
        onConfirm={() => void handleRun()}
        title="¿Probar en vivo?"
        message="Se van a ejecutar de verdad las reglas activas de este disparador: los mensajes se envían a los clientes."
        confirmLabel="Sí, ejecutar"
        variant="warning"
      />

      <ConfirmDialog
        isOpen={ruleToDelete !== null}
        onClose={() => setRuleToDelete(null)}
        onConfirm={() => ruleToDelete && handleDelete(ruleToDelete.id)}
        title="¿Eliminar automatización?"
        message={`Vas a eliminar la regla "${ruleToDelete?.nombre ?? ''}". Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={ruleToDelete !== null && deleting === ruleToDelete.id}
      />
    </div>
  );
}
