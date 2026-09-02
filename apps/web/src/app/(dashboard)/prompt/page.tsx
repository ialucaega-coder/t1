'use client';

import { useState } from 'react';
import {
  Plus, Copy, Check, Pencil, Trash2, X, Save, FileText,
  Loader2, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { usePrompts } from '@/hooks/use-prompts';
import { useClipboard } from '@/hooks';
import * as promptsApi from '@/lib/api/prompts';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { Modal } from '@/components/ui/Modal';

const CATEGORIES = ['General', 'Reservas', 'Notificaciones', 'Seguimiento', 'Ventas', 'Soporte'];

interface PromptFormData {
  name: string;
  category: string;
  content: string;
  isActive: boolean;
}

export default function PromptPage() {
  const { prompts, isLoading, error, refetch } = usePrompts();
  const { copiedId, copy } = useClipboard();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromptFormData>({ name: '', category: 'General', content: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  function openCreate() {
    setEditingId(null);
    setForm({ name: '', category: 'General', content: '', isActive: true });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(prompt: PromptFormData & { id: string }) {
    setEditingId(prompt.id);
    setForm({ name: prompt.name, category: prompt.category, content: prompt.content, isActive: prompt.isActive });
    setFormError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { setFormError('El nombre es obligatorio'); return; }
    if (!form.content.trim()) { setFormError('El contenido es obligatorio'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await promptsApi.updatePrompt(editingId, form);
      } else {
        await promptsApi.createPrompt(form);
      }
      setShowModal(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await promptsApi.deletePrompt(id);
      refetch();
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggle(prompt: { id: string; name: string; category: string; content: string; isActive: boolean }) {
    await promptsApi.updatePrompt(prompt.id, { isActive: !prompt.isActive });
    refetch();
  }

  if (isLoading) return <LoadingSpinner label="Cargando prompts..." />;

  const activeCount = prompts.filter((p) => p.isActive).length;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Prompts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {prompts.length} prompt{prompts.length !== 1 ? 's' : ''} · {activeCount} activo{activeCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo prompt
        </button>
      </div>

      <p className="text-sm text-slate-400 max-w-2xl">
        Plantillas de mensaje para tu bot. Usalas como sistema prompt, respuestas rápidas o
        notificaciones automáticas. Las variables entre {"{ }"} se reemplazan automáticamente.
      </p>

      {/* Grid */}
      {prompts.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No hay prompts todavía.</p>
          <button onClick={openCreate} className="btn-primary text-xs mt-3">
            <Plus className="h-3.5 w-3.5" /> Crear primer prompt
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {prompts.map((prompt) => (
            <div key={prompt.id} className="card-accent flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-white truncate">{prompt.name}</h3>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">{prompt.category}</span>
                </div>
                <button
                  onClick={() => handleToggle(prompt)}
                  className="shrink-0 ml-2"
                  title={prompt.isActive ? 'Desactivar' : 'Activar'}
                >
                  {prompt.isActive ? (
                    <ToggleRight className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-slate-600" />
                  )}
                </button>
              </div>

              <pre className="flex-1 text-xs text-slate-400 bg-surface rounded-lg p-3 mt-1 mb-3 whitespace-pre-wrap font-mono overflow-hidden max-h-28 leading-relaxed">
                {prompt.content}
              </pre>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => copy(prompt.id, prompt.content)}
                  className="btn-secondary text-xs py-1 px-2 flex-1"
                >
                  {copiedId === prompt.id ? (
                    <><Check className="h-3 w-3 text-emerald-400" /> Copiado</>
                  ) : (
                    <><Copy className="h-3 w-3" /> Copiar</>
                  )}
                </button>
                <button
                  onClick={() => openEdit({ ...prompt })}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-colors"
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(prompt.id)}
                  disabled={deleting === prompt.id}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Eliminar"
                >
                  {deleting === prompt.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? 'Editar prompt' : 'Nuevo prompt'}
        size="md"
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {formError}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nombre *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input"
              placeholder="Ej: Saludo inicial"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Categoría</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="input"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Contenido *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              className="input min-h-[140px] resize-y font-mono text-xs leading-relaxed"
              placeholder={"Hola {nombre} 👋 Bienvenido a {negocio}.\n\n¿En qué te puedo ayudar?"}
            />
            <p className="text-[10px] text-slate-600 mt-1">
              Usá {"{ }"} para variables: {"{nombre}"}, {"{negocio}"}, {"{fecha}"}, {"{servicio}"}, {"{hora}"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
              className="flex items-center gap-2"
            >
              {form.isActive ? (
                <ToggleRight className="h-5 w-5 text-emerald-400" />
              ) : (
                <ToggleLeft className="h-5 w-5 text-slate-600" />
              )}
              <span className="text-xs text-slate-400">
                {form.isActive ? 'Activo' : 'Inactivo'}
              </span>
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...</>
              ) : (
                <><Save className="h-3.5 w-3.5" /> {editingId ? 'Guardar cambios' : 'Crear prompt'}</>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
