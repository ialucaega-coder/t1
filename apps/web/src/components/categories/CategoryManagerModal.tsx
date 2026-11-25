'use client';

import { useState } from 'react';
import { Pencil, Trash2, Check, X as XIcon, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import * as categoriesApi from '@/lib/api/categories';
import type { Category } from '@/types';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  /** Se llama después de crear/renombrar/eliminar para que la pantalla recargue las categorías. */
  onChanged: () => void;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function usageText(c: Category): string {
  const products = c._count?.products ?? 0;
  const services = c._count?.services ?? 0;
  return `${products} producto${products !== 1 ? 's' : ''} · ${services} servicio${services !== 1 ? 's' : ''}`;
}

/** Gestor de categorías: crear, renombrar y eliminar (con confirmación). */
export function CategoryManagerModal({ isOpen, onClose, categories, onChanged }: CategoryManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { setError('El nombre es obligatorio'); return; }
    setBusy(true);
    setError('');
    try {
      await categoriesApi.createCategory({ name });
      setNewName('');
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Error al crear la categoría'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    const name = editingName.trim();
    if (!name) { setError('El nombre es obligatorio'); return; }
    setBusy(true);
    setError('');
    try {
      await categoriesApi.updateCategory(id, { name });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Error al renombrar la categoría'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const inUse = (target._count?.products ?? 0) + (target._count?.services ?? 0) > 0;
    setBusy(true);
    setError('');
    try {
      // Si tiene items, el usuario ya confirmó que queden sin categoría.
      await categoriesApi.deleteCategory(target.id, { detach: inUse });
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Error al eliminar la categoría'));
    } finally {
      setPendingDelete(null);
      setBusy(false);
    }
  }

  const inUseDelete = pendingDelete
    ? (pendingDelete._count?.products ?? 0) + (pendingDelete._count?.services ?? 0) > 0
    : false;

  return (
    <>
      <Modal isOpen={isOpen} onClose={pendingDelete ? () => {} : onClose} title="Categorías" size="md">
        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
          )}

          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="input flex-1"
              placeholder="Nombre de la nueva categoría"
              maxLength={80}
              aria-label="Nombre de la nueva categoría"
            />
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              <Plus className="h-3.5 w-3.5" /> Agregar
            </button>
          </form>

          {categories.length === 0 ? (
            <p className="text-xs text-slate-500">Todavía no hay categorías.</p>
          ) : (
            <ul className="space-y-1.5">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
                  {editingId === c.id ? (
                    <>
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="input flex-1"
                        maxLength={80}
                        aria-label={`Nuevo nombre para ${c.name}`}
                        autoFocus
                      />
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleRename(c.id)} disabled={busy} title="Guardar nombre"
                          className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">
                          <Check className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} title="Cancelar"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50">
                          <XIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500">{usageText(c)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => { setEditingId(c.id); setEditingName(c.name); setError(''); }}
                          title={`Renombrar ${c.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => { setPendingDelete(c); setError(''); }}
                          title={`Eliminar ${c.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Eliminar categoría"
        message={
          pendingDelete
            ? inUseDelete
              ? `"${pendingDelete.name}" tiene ${usageText(pendingDelete)}. Si la eliminás, van a quedar sin categoría.`
              : `¿Eliminar la categoría "${pendingDelete.name}"?`
            : ''
        }
        confirmLabel={inUseDelete ? 'Eliminar y dejar sin categoría' : 'Eliminar'}
        variant="danger"
        loading={busy}
      />
    </>
  );
}
