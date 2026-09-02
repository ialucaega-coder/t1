'use client';

import { useState } from 'react';
import {
  Megaphone,
  Plus,
  Send,
  Clock,
  Trash2,
  Edit3,
  X,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { useCampaigns } from '@/hooks/use-campaigns';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  draft: { label: 'Borrador', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  scheduled: { label: 'Programada', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  sent: { label: 'Enviada', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  cancelled: { label: 'Cancelada', class: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  email: 'Email',
  sms: 'SMS',
};

interface CampaignForm {
  name: string;
  description: string;
  channel: string;
  scheduledAt: string;
}

const emptyForm: CampaignForm = { name: '', description: '', channel: 'whatsapp', scheduledAt: '' };

export default function CampanasPage() {
  const { campaigns, isLoading, error, refetch, createCampaign, updateCampaign, deleteCampaign } =
    useCampaigns();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(c: typeof campaigns[0]) {
    setForm({
      name: c.name,
      description: c.description || '',
      channel: c.channel,
      scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
    });
    setEditingId(c.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateCampaign(editingId, {
          name: form.name,
          description: form.description || null,
          channel: form.channel,
          scheduledAt: form.scheduledAt || undefined,
        });
      } else {
        await createCampaign({
          name: form.name,
          description: form.description || null,
          channel: form.channel,
          scheduledAt: form.scheduledAt || undefined,
        });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving campaign:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteCampaign(id);
    } finally {
      setDeleting(null);
    }
  }

  async function handleSend(id: string) {
    setSending(id);
    try {
      await updateCampaign(id, { status: 'sent' });
    } finally {
      setSending(null);
    }
  }

  if (isLoading) {
    return <LoadingSpinner label="Cargando campañas..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Campañas</h1>
          <p className="text-sm text-slate-400 mt-1">
            Enviá mensajes masivos a tus clientes por WhatsApp, Telegram o Email.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva campaña
        </button>
      </div>

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 py-16 text-center">
          <Megaphone className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-white mb-1">Sin campañas</h3>
          <p className="text-sm text-slate-400 mb-4">
            Creá tu primera campaña para llegar a todos tus clientes.
          </p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Crear campaña
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((c) => {
            const statusInfo = STATUS_LABELS[c.status] || STATUS_LABELS.draft;
            return (
              <div
                key={c.id}
                className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-white truncate">{c.name}</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${statusInfo.class}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-sm text-slate-400 mb-2 line-clamp-2">{c.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {CHANNEL_LABELS[c.channel] || c.channel}
                    </span>
                    {c.scheduledAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(c.scheduledAt).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                    <span>
                      Creada{' '}
                      {new Date(c.createdAt).toLocaleDateString('es-AR')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.status === 'draft' && (
                    <>
                      <button
                        onClick={() => handleSend(c.id)}
                        disabled={sending === c.id}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {sending === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Enviar
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={deleting === c.id}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    {deleting === c.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Editar campaña' : 'Nueva campaña'}
              </h2>
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
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Promo Septiembre"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Descripción / Mensaje
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  placeholder="Texto del mensaje que se enviará a los clientes..."
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Canal</label>
                  <select
                    value={form.channel}
                    onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="telegram">Telegram</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Programar envío
                  </label>
                  <input
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
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
                disabled={saving || !form.name.trim()}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
