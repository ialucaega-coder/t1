'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle, Plus, X, Edit2, Trash2, Copy, Check, Search,
} from 'lucide-react';
import * as templatesApi from '@/lib/api/templates';
import type { Template } from '@/lib/api/templates';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const CATEGORY_OPTIONS = ['Recordatorio', 'Marketing', 'Cobro', 'Post-venta', 'Reenganche', 'Otro'];

export default function PlantillasPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('Recordatorio');

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await templatesApi.getTemplates('whatsapp');
      setTemplates(data);
    } catch {
      setError('Error al cargar plantillas');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormDesc('');
    setFormContent('');
    setFormCategory('Recordatorio');
    setShowForm(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setFormName(t.name);
    setFormDesc(t.description || '');
    setFormContent(t.content);
    setFormCategory(t.category || 'Otro');
    setShowForm(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formContent.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = await templatesApi.updateTemplate(editing.id, {
          name: formName,
          description: formDesc,
          content: formContent,
          category: formCategory,
        });
        setTemplates((prev) => prev.map((t) => (t.id === editing.id ? updated : t)));
      } else {
        const created = await templatesApi.createTemplate({
          name: formName,
          description: formDesc || undefined,
          content: formContent,
          category: formCategory,
          type: 'whatsapp',
        });
        setTemplates((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch {
      setError('Error al guardar plantilla');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta plantilla?')) return;
    try {
      await templatesApi.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError('Error al eliminar');
    }
  }

  function handleCopy(id: string, content: string) {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.category || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={() => { setError(''); fetchTemplates(); }} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Plantillas WhatsApp</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Plantillas HSM para mensajes proactivos fuera de la ventana de 24h
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nueva plantilla
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar plantillas..."
          className="input w-full pl-9"
        />
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <div className="rounded-xl border border-brand-400/30 bg-slate-800/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {editing ? 'Editar plantilla' : 'Nueva plantilla'}
            </h3>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej: Recordatorio de cita" className="input w-full" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Categoría</label>
              <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="input w-full">
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
            <input type="text" value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
              placeholder="Breve descripción de uso..." className="input w-full" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">
              Contenido del mensaje *
            </label>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={"Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}}.\n\nUsa {{1}}, {{2}}, etc. para variables dinámicas."}
              rows={5}
              className="input w-full resize-none font-mono text-xs"
            />
            <p className="text-[10px] text-slate-600 mt-1">
              Variables: {'{{1}}'} = nombre, {'{{2}}'} = fecha, {'{{3}}'} = hora, {'{{4}}'} = servicio
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !formName.trim() || !formContent.trim()}
              className="btn-primary text-xs disabled:opacity-50">
              {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear plantilla'}
            </button>
          </div>
        </div>
      )}

      {/* Templates grid */}
      {isLoading ? (
        <LoadingSpinner label="Cargando plantillas..." />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <MessageCircle className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            {search ? 'Sin resultados' : 'No hay plantillas aún'}
          </p>
          {!search && (
            <button onClick={openCreate} className="btn-primary text-xs mt-3">
              <Plus className="h-3.5 w-3.5" /> Crear primera plantilla
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate">{t.name}</h3>
                  {t.description && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{t.description}</p>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] border shrink-0 ml-2 ${
                  t.category === 'Marketing'
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                }`}>
                  {t.category || 'General'}
                </span>
              </div>

              <div className="rounded-lg bg-slate-900/50 p-3">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed line-clamp-4">
                  {t.content}
                </pre>
              </div>

              <div className="flex items-center gap-1.5">
                <button onClick={() => handleCopy(t.id, t.content)}
                  className="btn-secondary text-[10px] py-1 px-2 flex-1">
                  {copied === t.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied === t.id ? 'Copiado' : 'Copiar'}
                </button>
                <button onClick={() => openEdit(t)}
                  className="btn-secondary text-[10px] py-1 px-2">
                  <Edit2 className="h-3 w-3" />
                </button>
                <button onClick={() => handleDelete(t.id)}
                  className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
