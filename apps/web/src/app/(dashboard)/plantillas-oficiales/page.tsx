'use client';

import { useEffect, useState } from 'react';
import {
  FileCheck,
  Plus,
  Send,
  Trash2,
  Edit3,
  X,
  Loader2,
  Check,
  Ban,
  Tag,
  Languages,
  AlertTriangle,
  Info,
} from 'lucide-react';
import * as waTemplatesApi from '@/lib/api/wa-templates';
import type {
  WaTemplate,
  WaTemplateCategory,
  WaTemplateStatus,
  WaButtonType,
  WaTemplateButton,
} from '@/lib/api/wa-templates';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';

// Estilos del badge de ESTADO (misma lógica visual que campañas).
const STATUS_INFO: Record<WaTemplateStatus, { label: string; class: string }> = {
  DRAFT: { label: 'Borrador', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  PENDING: { label: 'Pendiente', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  APPROVED: { label: 'Aprobada', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  REJECTED: { label: 'Rechazada', class: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

const CATEGORY_LABELS: Record<WaTemplateCategory, string> = {
  UTILITY: 'Utilidad',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticación',
};

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'es_AR', label: 'Español (Argentina)' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
];

const BUTTON_TYPE_LABELS: Record<WaButtonType, string> = {
  QUICK_REPLY: 'Respuesta rápida',
  URL: 'Enlace (URL)',
  PHONE_NUMBER: 'Teléfono',
};

interface TemplateForm {
  name: string;
  language: string;
  category: WaTemplateCategory;
  header: string;
  body: string;
  footer: string;
  buttons: WaTemplateButton[];
  example: string[];
}

const EMPTY_FORM: TemplateForm = {
  name: '',
  language: 'es_AR',
  category: 'UTILITY',
  header: '',
  body: '',
  footer: '',
  buttons: [],
  example: [],
};

// Cuenta las variables {{1}} {{2}}... del body. Devuelve el índice máximo
// (Meta exige consecutivas desde 1, así que el máximo = cantidad de variables).
function varCount(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m.replace(/\D/g, ''), 10);
    if (n > max) max = n;
  }
  return max;
}

export default function PlantillasOficialesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Modal de alta/edición.
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Acción en curso por fila (submit/approve/delete): guardamos el id.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal de rechazo con motivo.
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await waTemplatesApi.list();
        if (!cancelled) setTemplates(data.templates);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar las plantillas');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refetch = () => setReloadToken((t) => t + 1);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(t: WaTemplate) {
    setForm({
      name: t.name,
      language: t.language,
      category: t.category,
      header: t.header ?? '',
      body: t.body,
      footer: t.footer ?? '',
      buttons: t.buttons ? t.buttons.map((b) => ({ ...b })) : [],
      example: t.example ? [...t.example] : [],
    });
    setEditingId(t.id);
    setShowModal(true);
  }

  // Mantiene el array de ejemplos sincronizado con la cantidad de variables del body.
  function updateBody(body: string) {
    const n = varCount(body);
    setForm((f) => {
      const example = Array.from({ length: n }, (_, i) => f.example[i] ?? '');
      return { ...f, body, example };
    });
  }

  function updateExample(index: number, value: string) {
    setForm((f) => {
      const example = [...f.example];
      example[index] = value;
      return { ...f, example };
    });
  }

  // --- Botones (opcional, hasta 3) ---
  function addButton() {
    setForm((f) =>
      f.buttons.length >= 3 ? f : { ...f, buttons: [...f.buttons, { type: 'QUICK_REPLY', text: '', value: '' }] }
    );
  }

  function updateButton(index: number, patch: Partial<WaTemplateButton>) {
    setForm((f) => ({
      ...f,
      buttons: f.buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    }));
  }

  function removeButton(index: number) {
    setForm((f) => ({ ...f, buttons: f.buttons.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    const name = form.name.trim();
    const body = form.body.trim();
    if (!name || !body) {
      toast({ type: 'error', message: 'El nombre y el cuerpo son obligatorios' });
      return;
    }

    // Armamos el payload: campos opcionales vacíos se mandan como undefined.
    const n = varCount(body);
    const buttons = form.buttons
      .map((b) => ({ ...b, text: b.text.trim(), value: b.value?.trim() || undefined }))
      .filter((b) => b.text);
    const example = n > 0 ? form.example.slice(0, n).map((e) => e.trim()) : undefined;

    const payload = {
      name,
      language: form.language,
      category: form.category,
      header: form.header.trim() || undefined,
      body,
      footer: form.footer.trim() || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
      example,
    };

    setSaving(true);
    try {
      if (editingId) {
        const updated = await waTemplatesApi.update(editingId, payload);
        setTemplates((prev) => prev.map((t) => (t.id === editingId ? updated : t)));
        toast({ type: 'success', message: 'Plantilla actualizada correctamente' });
      } else {
        const created = await waTemplatesApi.create(payload);
        setTemplates((prev) => [created, ...prev]);
        toast({ type: 'success', message: 'Plantilla creada correctamente' });
      }
      setShowModal(false);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al guardar la plantilla' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(id: string) {
    setBusyId(id);
    try {
      const updated = await waTemplatesApi.submit(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
      toast({ type: 'success', message: 'Plantilla enviada a aprobación' });
    } catch (err) {
      // El server puede responder 422 (faltan ejemplos) o 409 (transición inválida).
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al enviar a aprobación' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleApprove(id: string) {
    setBusyId(id);
    try {
      const updated = await waTemplatesApi.approve(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
      toast({ type: 'success', message: 'Plantilla aprobada' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al aprobar la plantilla' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject() {
    if (!rejectId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast({ type: 'error', message: 'Indicá el motivo del rechazo' });
      return;
    }
    setRejecting(true);
    try {
      const updated = await waTemplatesApi.reject(rejectId, reason);
      setTemplates((prev) => prev.map((t) => (t.id === rejectId ? updated : t)));
      toast({ type: 'success', message: 'Plantilla rechazada' });
      setRejectId(null);
      setRejectReason('');
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al rechazar la plantilla' });
    } finally {
      setRejecting(false);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await waTemplatesApi.remove(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast({ type: 'success', message: 'Plantilla eliminada' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al eliminar la plantilla' });
    } finally {
      setBusyId(null);
    }
  }

  const formVars = varCount(form.body);

  if (isLoading) {
    return <LoadingSpinner label="Cargando plantillas oficiales..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <FileCheck className="h-6 w-6 text-brand-400" />
            <h1 className="text-2xl font-bold text-white">Plantillas oficiales (HSM)</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Las plantillas HSM son mensajes preaprobados por WhatsApp que te dejan escribirle primero a un cliente
            <strong className="text-white"> fuera de la ventana de 24h</strong> (broadcast, recordatorios, promos).
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary shrink-0 text-sm">
          <Plus className="h-4 w-4" />
          Nueva plantilla
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {templates.length === 0 && !error ? (
        <EmptyState
          icon={FileCheck}
          title="Todavía no tenés plantillas oficiales"
          description="Creá tu primera plantilla HSM para poder enviar broadcasts por WhatsApp fuera de la ventana de 24h. Una vez redactada, enviala a aprobación."
          action={{ label: 'Crear plantilla', onClick: openCreate }}
        />
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => {
            const statusInfo = STATUS_INFO[t.status];
            const canEdit = t.status === 'DRAFT' || t.status === 'REJECTED';
            const canSubmit = t.status === 'DRAFT' || t.status === 'REJECTED';
            const canReview = isAdmin && t.status === 'PENDING';
            const busy = busyId === t.id;
            return (
              <div key={t.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="font-semibold text-white truncate font-mono text-sm">{t.name}</h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${statusInfo.class}`}
                      >
                        {statusInfo.label}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-700/60 text-slate-300 border border-slate-600">
                        <Tag className="h-3 w-3" />
                        {CATEGORY_LABELS[t.category]}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Languages className="h-3 w-3" />
                        {t.language}
                      </span>
                    </div>

                    {t.header && <p className="text-sm font-semibold text-slate-200">{t.header}</p>}
                    <p className="text-sm text-slate-400 whitespace-pre-wrap line-clamp-3">{t.body}</p>
                    {t.footer && <p className="text-xs text-slate-500 mt-1">{t.footer}</p>}

                    {t.buttons && t.buttons.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {t.buttons.map((b, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-[11px] text-slate-300"
                          >
                            {b.text}
                          </span>
                        ))}
                      </div>
                    )}

                    {t.status === 'REJECTED' && t.rejectionReason && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          <strong>Motivo del rechazo:</strong> {t.rejectionReason}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canSubmit && (
                      <button
                        onClick={() => handleSubmit(t.id)}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        Enviar a aprobación
                      </button>
                    )}
                    {canReview && (
                      <>
                        <button
                          onClick={() => handleApprove(t.id)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Aprobar
                        </button>
                        <button
                          onClick={() => {
                            setRejectId(t.id);
                            setRejectReason('');
                          }}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Rechazar
                        </button>
                      </>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                        aria-label="Editar plantilla"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={busy}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      aria-label="Eliminar plantilla"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-6 my-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Editar plantilla' : 'Nueva plantilla'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ej: recordatorio_turno"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Solo minúsculas, números y guión_bajo. Ej: <span className="font-mono">promo_octubre</span>.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Idioma</label>
                  <select
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Categoría</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as WaTemplateCategory })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="UTILITY">Utilidad</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="AUTHENTICATION">Autenticación</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Encabezado <span className="text-slate-500 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.header}
                  onChange={(e) => setForm({ ...form, header: e.target.value })}
                  maxLength={60}
                  placeholder="Ej: Confirmación de turno"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Cuerpo</label>
                <textarea
                  value={form.body}
                  onChange={(e) => updateBody(e.target.value)}
                  rows={4}
                  maxLength={1024}
                  placeholder="Hola {{1}}, te recordamos tu turno del {{2}}. ¡Te esperamos!"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none resize-y"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Usá variables <span className="font-mono">{'{{1}}'}</span> <span className="font-mono">{'{{2}}'}</span>…
                  consecutivas desde 1. Se reemplazan por datos del cliente al enviar.
                </p>
              </div>

              {/* Ejemplos por cada variable detectada en el body */}
              {formVars > 0 && (
                <div className="rounded-lg border border-slate-600 bg-slate-700/40 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-slate-300">Ejemplos de variables</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    WhatsApp pide un ejemplo por variable para aprobar la plantilla. Los necesitás al enviar a aprobación.
                  </p>
                  {Array.from({ length: formVars }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-500 shrink-0 w-10">{`{{${i + 1}}}`}</span>
                      <input
                        type="text"
                        value={form.example[i] ?? ''}
                        onChange={(e) => updateExample(i, e.target.value)}
                        placeholder={`Ej: valor para {{${i + 1}}}`}
                        className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Pie <span className="text-slate-500 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.footer}
                  onChange={(e) => setForm({ ...form, footer: e.target.value })}
                  maxLength={60}
                  placeholder="Ej: Respondé STOP para no recibir más mensajes"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              {/* Botones (opcional, hasta 3) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-slate-300">
                    Botones <span className="text-slate-500 font-normal">(opcional, hasta 3)</span>
                  </label>
                  <button
                    type="button"
                    onClick={addButton}
                    disabled={form.buttons.length >= 3}
                    className="flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3.5 w-3.5" /> Agregar
                  </button>
                </div>
                {form.buttons.map((b, i) => (
                  <div key={i} className="rounded-lg border border-slate-600 bg-slate-700/40 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={b.type}
                        onChange={(e) => updateButton(i, { type: e.target.value as WaButtonType })}
                        className="rounded-lg border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                      >
                        {(Object.keys(BUTTON_TYPE_LABELS) as WaButtonType[]).map((bt) => (
                          <option key={bt} value={bt}>
                            {BUTTON_TYPE_LABELS[bt]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={b.text}
                        onChange={(e) => updateButton(i, { text: e.target.value })}
                        maxLength={25}
                        placeholder="Texto del botón"
                        className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeButton(i)}
                        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        aria-label="Quitar botón"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {b.type !== 'QUICK_REPLY' && (
                      <input
                        type="text"
                        value={b.value ?? ''}
                        onChange={(e) => updateButton(i, { value: e.target.value })}
                        placeholder={b.type === 'URL' ? 'https://...' : '+54 9 11 ...'}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    )}
                  </div>
                ))}
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
                disabled={saving || !form.name.trim() || !form.body.trim()}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de rechazo con motivo (solo admin) */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Rechazar plantilla</h2>
              <button
                onClick={() => setRejectId(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-3">
              Indicá por qué se rechaza. El motivo queda visible en la plantilla para que se pueda corregir.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ej: el cuerpo no coincide con la categoría declarada"
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none resize-none"
            />
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setRejectId(null)}
                className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleReject}
                disabled={rejecting || !rejectReason.trim()}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {rejecting && <Loader2 className="h-4 w-4 animate-spin" />}
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
