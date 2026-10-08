'use client';

/**
 * Componentes del CRM de clientes (etiquetas + nota interna).
 * Ingeniería inversa del módulo de Contactos de respond.io y las etiquetas de
 * SalesMartly: catálogo de etiquetas con color, asignación por cliente y nota.
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, Tag as TagIcon, Check, Save } from 'lucide-react';
import * as clientsApi from '@/lib/api/clients';
import type { ClientTag, ClientTagColor } from '@/types';
import { useToast } from '@/components/common/Toast';

/** Clases por color (fondo/texto/borde) alineadas con el panel oscuro. */
export const TAG_COLOR_CLASSES: Record<ClientTagColor, string> = {
  slate: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  red: 'bg-red-500/10 text-red-400 border-red-500/30',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  green: 'bg-green-500/10 text-green-400 border-green-500/30',
  teal: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  pink: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
};

export const TAG_COLORS: ClientTagColor[] = [
  'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink',
];

/** Chip de una etiqueta. Opcionalmente clickeable (toggle) o removible. */
export function TagChip({
  tag,
  active = true,
  onClick,
  onRemove,
}: {
  tag: ClientTag;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const base = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
    active ? TAG_COLOR_CLASSES[tag.color] : 'border-slate-700 text-slate-500 opacity-60'
  }`;
  return (
    <span className={base}>
      {onClick ? (
        <button type="button" onClick={onClick} className="inline-flex items-center gap-1">
          {active && <Check className="h-2.5 w-2.5" />}
          {tag.label}
        </button>
      ) : (
        <span>{tag.label}</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 hover:text-white" aria-label={`Quitar ${tag.label}`}>
          ×
        </button>
      )}
    </span>
  );
}

/**
 * Gestor del catálogo de etiquetas del negocio (crear, renombrar, recolorear,
 * borrar). Guarda todo el set de una vez (PUT /clients/crm/tags).
 */
export function TagManager({
  tags,
  onSaved,
}: {
  tags: ClientTag[];
  onSaved: (tags: ClientTag[]) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ClientTag[]>(tags);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { setDraft(tags); }, [tags]);

  const genId = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t_${Date.now()}_${Math.random()}`);

  const add = () =>
    setDraft((d) => (d.length >= 50 ? d : [...d, { id: genId(), label: '', color: 'blue' }]));
  const update = (i: number, patch: Partial<ClientTag>) =>
    setDraft((d) => d.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const remove = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));

  async function save() {
    const clean = draft
      .map((t) => ({ ...t, label: t.label.trim() }))
      .filter((t) => t.label);
    setIsSaving(true);
    try {
      const res = await clientsApi.saveClientTags(clean);
      onSaved(res.tags);
      toast({ type: 'success', message: 'Etiquetas guardadas' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al guardar etiquetas' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TagIcon className="h-4 w-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-white">Etiquetas del negocio</h3>
        <span className="text-[11px] text-slate-500">{draft.length}/50</span>
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-slate-500">Sin etiquetas. Creá la primera para segmentar tus clientes.</p>
      )}

      <div className="space-y-2">
        {draft.map((tag, i) => (
          <div key={tag.id} className="flex items-center gap-2">
            <input
              className="input flex-1 py-1 text-sm"
              value={tag.label}
              maxLength={40}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Nombre de la etiqueta (ej: VIP, Moroso, Recurrente)"
            />
            <div className="flex items-center gap-1">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update(i, { color: c })}
                  aria-label={`Color ${c}`}
                  className={`h-4 w-4 rounded-full border ${TAG_COLOR_CLASSES[c]} ${
                    tag.color === c ? 'ring-2 ring-white/40' : ''
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
              aria-label="Borrar etiqueta"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={add} disabled={draft.length >= 50} className="btn-secondary text-xs disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Nueva etiqueta
        </button>
        <button type="button" onClick={save} disabled={isSaving} className="btn-primary text-xs">
          <Save className="h-3.5 w-3.5" /> {isSaving ? 'Guardando...' : 'Guardar etiquetas'}
        </button>
      </div>
    </div>
  );
}

/** Editor de etiquetas asignadas + nota interna de un cliente concreto. */
export function ClientTagEditor({
  clientId,
  catalog,
  assigned,
  note,
  onChanged,
}: {
  clientId: string;
  catalog: ClientTag[];
  assigned: string[];
  note: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [sel, setSel] = useState<string[]>(assigned);
  const [noteDraft, setNoteDraft] = useState(note);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => { setSel(assigned); }, [assigned, clientId]);
  useEffect(() => { setNoteDraft(note); }, [note, clientId]);

  async function toggle(tagId: string) {
    const next = sel.includes(tagId) ? sel.filter((t) => t !== tagId) : [...sel, tagId];
    setSel(next); // optimista
    try {
      await clientsApi.setClientTags(clientId, next);
      onChanged();
    } catch (err) {
      setSel(sel); // revertir
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al asignar etiqueta' });
    }
  }

  async function saveNote() {
    setSavingNote(true);
    try {
      await clientsApi.setClientNote(clientId, noteDraft);
      onChanged();
      toast({ type: 'success', message: 'Nota guardada' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Error al guardar la nota' });
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Etiquetas</h3>
        {catalog.length === 0 ? (
          <p className="text-xs text-slate-600">
            No hay etiquetas creadas. Usá &quot;Gestionar etiquetas&quot; para crear la primera.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {catalog.map((tag) => (
              <TagChip key={tag.id} tag={tag} active={sel.includes(tag.id)} onClick={() => toggle(tag.id)} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Nota interna</h3>
        <textarea
          className="input min-h-[70px] resize-y text-sm"
          value={noteDraft}
          maxLength={2000}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Contexto para el equipo (no lo ve el cliente): preferencias, acuerdos, recordatorios..."
        />
        {noteDraft !== note && (
          <div className="flex justify-end mt-1">
            <button type="button" onClick={saveNote} disabled={savingNote} className="btn-primary text-xs">
              <Save className="h-3 w-3" /> {savingNote ? 'Guardando...' : 'Guardar nota'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
