'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Store, Plus, X, Edit2, Trash2, Copy, Check, Search, Zap, ChevronRight,
} from 'lucide-react';
import * as templatesApi from '@/lib/api/templates';
import type { Template } from '@/lib/api/templates';
import { BUSINESS_TEMPLATES as PRESETS } from '@/constants/business-templates';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Building2 } from 'lucide-react';

export default function PlantillasNegocioPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('');

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await templatesApi.getTemplates('business');
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
    setFormCategory('');
    setShowForm(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setFormName(t.name);
    setFormDesc(t.description || '');
    setFormContent(t.content);
    setFormCategory(t.category || '');
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
          category: formCategory || undefined,
        });
        setTemplates((prev) => prev.map((t) => (t.id === editing.id ? updated : t)));
      } else {
        const created = await templatesApi.createTemplate({
          name: formName,
          description: formDesc || undefined,
          content: formContent,
          category: formCategory || undefined,
          type: 'business',
        });
        setTemplates((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch {
      setError('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await templatesApi.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setDeleteTarget(null);
    } catch {
      setError('Error al eliminar');
    } finally {
      setDeleting(false);
    }
  }

  async function handleInstallPreset(preset: { name: string; description: string }) {
    setInstalling(preset.name);
    try {
      const content = `Plantilla de negocio: ${preset.name}\n\nConfiguración base para ${preset.description.toLowerCase()}\n\nPersonalizá este contenido con los datos de tu negocio: nombre, dirección, horarios, servicios, precios y políticas.`;
      const created = await templatesApi.createTemplate({
        name: preset.name,
        description: preset.description,
        content,
        category: 'Giro',
        type: 'business',
      });
      setTemplates((prev) => [...prev, created]);
    } catch {
      setError('Error al instalar plantilla');
    } finally {
      setInstalling(null);
    }
  }

  function handleCopy(id: string, content: string) {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const installedNames = new Set(templates.map((t) => t.name));
  const availablePresets = PRESETS.filter((p) => !installedNames.has(p.name));

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={() => { setError(''); fetchTemplates(); }} />}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
        title="Eliminar plantilla"
        message="¿Eliminar esta plantilla de negocio?"
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Plantillas de Negocio</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configuraciones pre-armadas por giro. Instalá una y personalizala.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Crear personalizada
        </button>
      </div>

      {/* Installed templates */}
      {templates.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Mis plantillas ({templates.length})</h2>
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="input w-full pl-7 text-xs py-1.5"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-brand-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-white truncate">{t.name}</h3>
                  </div>
                  {t.category && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] border bg-brand-400/10 text-brand-400 border-brand-400/20 shrink-0">
                      {t.category}
                    </span>
                  )}
                </div>
                {t.description && (
                  <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>
                )}
                <div className="rounded-lg bg-slate-900/50 p-2.5">
                  <pre className="text-[11px] text-slate-400 whitespace-pre-wrap font-mono leading-relaxed line-clamp-3">
                    {t.content}
                  </pre>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => handleCopy(t.id, t.content)}
                    className="btn-secondary text-[10px] py-1 px-2 flex-1">
                    {copied === t.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copied === t.id ? 'Copiado' : 'Copiar prompt'}
                  </button>
                  <button onClick={() => openEdit(t)}
                    className="btn-secondary text-[10px] py-1 px-2">
                    <Edit2 className="h-3 w-3" />
                  </button>
                  <button onClick={() => setDeleteTarget(t.id)}
                    className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create/Edit form */}
      {showForm && (
        <div className="rounded-xl border border-brand-400/30 bg-slate-800/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {editing ? 'Editar plantilla' : 'Nueva plantilla personalizada'}
            </h3>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej: Mi barbería" className="input w-full" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Categoría</label>
              <input type="text" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}
                placeholder="Ej: Giro, Personalizada" className="input w-full" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
            <input type="text" value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
              placeholder="¿Para qué es esta plantilla?" className="input w-full" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Contenido / Prompt *</label>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="El prompt o configuración de tu bot para este tipo de negocio..."
              rows={6}
              className="input w-full resize-none font-mono text-xs"
            />
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

      {/* Available presets */}
      {availablePresets.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            <h2 className="text-sm font-semibold text-white">Plantillas disponibles</h2>
            <span className="text-[10px] text-slate-500">({availablePresets.length} giros)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {availablePresets.map((preset) => (
              <div key={preset.name}
                className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Store className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-semibold text-white">{preset.name}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">{preset.description}</p>
                </div>
                <button
                  onClick={() => handleInstallPreset(preset)}
                  disabled={installing === preset.name}
                  className="btn-primary text-xs w-full justify-center disabled:opacity-50"
                >
                  {installing === preset.name ? (
                    'Instalando...'
                  ) : (
                    <>Usar plantilla <ChevronRight className="h-3 w-3" /></>
                  )}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!isLoading && templates.length === 0 && availablePresets.length === 0 && (
        <EmptyState icon={Building2} title="No hay plantillas" description="Todas las plantillas fueron instaladas" />
      )}
    </div>
  );
}
