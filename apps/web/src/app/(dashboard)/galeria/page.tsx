'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, Save, X, Loader2, Images, ImageIcon, Video, Music, ExternalLink,
} from 'lucide-react';
import * as galleryApi from '@/lib/api/gallery';
import type { GalleryItem, GalleryTipo, CreateGalleryItemInput } from '@/lib/api/gallery';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/ui/Modal';

const TIPOS: { value: GalleryTipo; label: string }[] = [
  { value: 'image', label: 'Imagen' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
];

interface FormData {
  url: string;
  tipo: GalleryTipo;
  titulo: string;
  descripcion: string;
}

const EMPTY_FORM: FormData = { url: '', tipo: 'image', titulo: '', descripcion: '' };

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function TipoIcon({ tipo, className }: { tipo: GalleryTipo; className?: string }) {
  if (tipo === 'video') return <Video className={className} />;
  if (tipo === 'audio') return <Music className={className} />;
  return <ImageIcon className={className} />;
}

function Preview({ item }: { item: GalleryItem }) {
  if (item.tipo === 'video') {
    return (
      <video
        controls
        src={item.url}
        className="w-full h-40 rounded-lg bg-black object-contain"
      />
    );
  }
  if (item.tipo === 'audio') {
    return (
      <div className="w-full h-40 rounded-lg bg-surface flex flex-col items-center justify-center gap-3 p-3">
        <Music className="h-8 w-8 text-slate-500" />
        <audio controls src={item.url} className="w-full" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.url}
      alt={item.titulo || 'Imagen de la galería'}
      className="w-full h-40 rounded-lg bg-surface object-cover"
    />
  );
}

export default function GaleriaPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await galleryApi.getGallery();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar la galería');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.url.trim()) {
      setFormError('La URL es obligatoria');
      return;
    }
    if (!isHttpUrl(form.url)) {
      setFormError('La URL debe comenzar con http:// o https://');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload: CreateGalleryItemInput = {
        url: form.url.trim(),
        tipo: form.tipo,
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim(),
      };
      await galleryApi.createGalleryItem(payload);
      setShowModal(false);
      await load();
      toast({ type: 'success', message: 'Elemento agregado a la galería' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
      toast({ type: 'error', message: 'Error al agregar el elemento' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await galleryApi.deleteGalleryItem(id);
      await load();
      toast({ type: 'success', message: 'Elemento eliminado' });
    } catch {
      toast({ type: 'error', message: 'Error al eliminar el elemento' });
    } finally {
      setDeleting(null);
    }
  }

  if (isLoading) return <LoadingSpinner label="Cargando galería..." />;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={load} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Galería</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {items.length} elemento{items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> Agregar elemento
        </button>
      </div>

      <p className="text-sm text-slate-400 max-w-2xl">
        Cargá fotos, videos y audios reales por URL. El bot puede compartirlos en el chat y aparecen
        acá en el panel. Pegá el link directo del archivo (http:// o https://).
      </p>

      {/* Grid */}
      {items.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Galería vacía"
          description="Todavía no hay elementos. Agregá fotos, videos o audios por URL."
          action={{ label: 'Agregar primer elemento', onClick: openCreate }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item) => (
            <div key={item.id} className="card-accent flex flex-col">
              <Preview item={item} />

              <div className="flex items-start justify-between mt-3 mb-1">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-white truncate">
                    {item.titulo || 'Sin título'}
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase tracking-wider">
                    <TipoIcon tipo={item.tipo} className="h-3 w-3" />
                    {item.tipo}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  disabled={deleting === item.id}
                  className="shrink-0 ml-2 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Eliminar"
                >
                  {deleting === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {item.descripcion && (
                <p className="text-xs text-slate-400 mb-2 line-clamp-2">{item.descripcion}</p>
              )}

              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors truncate"
                title={item.url}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.url}</span>
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Agregar elemento" size="md">
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {formError}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1 block">URL *</label>
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              className="input"
              placeholder="https://ejemplo.com/foto.jpg"
            />
            <p className="text-[10px] text-slate-600 mt-1">
              Link directo al archivo. Debe empezar con http:// o https://
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Tipo</label>
            <select
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as GalleryTipo }))}
              className="input"
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Título</label>
            <input
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
              className="input"
              placeholder="Ej: Corte degradé"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Descripción</label>
            <textarea
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              className="input min-h-[80px] resize-y"
              placeholder="Detalle opcional para el bot y el panel"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary text-xs">
              <X className="h-3.5 w-3.5" /> Cancelar
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...</>
              ) : (
                <><Save className="h-3.5 w-3.5" /> Agregar</>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
