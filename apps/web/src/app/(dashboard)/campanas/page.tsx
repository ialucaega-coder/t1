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
  Users,
  CalendarX,
  Ban,
} from 'lucide-react';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useAuth } from '@/lib/auth-context';
import * as campaignsApi from '@/lib/api/campaigns';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  campaignFailedMessage,
  type CampaignFailedEvent,
  describeCampaignStatus,
  formatArgentina,
  isoToArgentinaInput,
  validateScheduleInput,
} from '@/components/campaigns/schedule';

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
  const { campaigns, isLoading, error, refetch, refreshSilently, createCampaign, updateCampaign, deleteCampaign, sendCampaign } =
    useCampaigns();
  const { business } = useAuth();
  // El server emite 'campaign:sent' al sala del negocio cuando una campaña termina de enviarse
  // (con colas el envío sigue en segundo plano). Refrescamos la lista, sin polling.
  useSocket(business?.id ?? null);
  useSocketEvent('campaign:sent', () => {
    refreshSilently();
  });
  // 'campaign:failed' trae el motivo: lo guardamos para explicar la tarjeta mientras no se
  // recargue la página (después se infiere, ver describeCampaignStatus).
  const [failReasons, setFailReasons] = useState<Record<string, string>>({});
  useSocketEvent<CampaignFailedEvent>('campaign:failed', (event) => {
    const id = event?.campaign?.id;
    if (id && event?.reason) setFailReasons((prev) => ({ ...prev, [id]: String(event.reason) }));
    toast({
      type: 'error',
      message: campaignFailedMessage(event?.campaign?.name ?? 'sin nombre', event?.reason, event?.envio),
    });
    refreshSilently();
  });
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [pendingSend, setPendingSend] = useState<{ id: string; name: string; channel: string } | null>(null);
  const [pendingSendCount, setPendingSendCount] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [unscheduling, setUnscheduling] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<{ id: string; name: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const { toast } = useToast();

  async function fetchRecipientCount(channel: string) {
    setLoadingRecipients(true);
    try {
      const data = await campaignsApi.getRecipients(channel);
      setRecipientCount(data.total);
    } catch {
      setRecipientCount(null);
    } finally {
      setLoadingRecipients(false);
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setEditingStatus(null);
    setScheduleError(null);
    setShowModal(true);
    fetchRecipientCount(emptyForm.channel);
  }

  function openEdit(c: typeof campaigns[0]) {
    setForm({
      name: c.name,
      description: c.description || '',
      channel: c.channel,
      // Solo se precarga la fecha de una campaña programada (en hora argentina).
      // En una fallida/borrador la fecha vieja ya pasó y no se puede reutilizar.
      scheduledAt: c.status === 'scheduled' && c.scheduledAt ? isoToArgentinaInput(c.scheduledAt) : '',
    });
    setEditingId(c.id);
    setEditingStatus(c.status);
    setScheduleError(null);
    setShowModal(true);
    fetchRecipientCount(c.channel);
  }

  function handleChannelChange(channel: string) {
    setForm({ ...form, channel });
    fetchRecipientCount(channel);
  }

  async function handleSave() {
    if (!form.name.trim()) return;

    // Fecha de programación: se valida en el front (no pasada) y se manda como ISO UTC.
    // Campo vacío al editar una campaña programada = desprogramar (null).
    let scheduledAt: string | null | undefined;
    if (form.scheduledAt) {
      const checked = validateScheduleInput(form.scheduledAt);
      if ('error' in checked) {
        setScheduleError(checked.error);
        return;
      }
      scheduledAt = checked.iso;
    } else if (editingId && editingStatus === 'scheduled') {
      scheduledAt = null;
    }
    setScheduleError(null);

    setSaving(true);
    try {
      if (editingId) {
        await updateCampaign(editingId, {
          name: form.name,
          description: form.description || null,
          channel: form.channel,
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
        });
        toast({ type: 'success', message: 'Campaña actualizada correctamente' });
      } else {
        await createCampaign({
          name: form.name,
          description: form.description || null,
          channel: form.channel,
          ...(typeof scheduledAt === 'string' ? { scheduledAt } : {}),
        });
        toast({
          type: 'success',
          message: scheduledAt ? 'Campaña programada correctamente' : 'Campaña creada correctamente',
        });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving campaign:', err);
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al guardar campaña' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(id: string) {
    setCancelling(true);
    try {
      await updateCampaign(id, { status: 'cancelled' });
      toast({ type: 'success', message: 'Campaña cancelada: no se va a enviar' });
      setPendingCancel(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'No se pudo cancelar la campaña' });
    } finally {
      setCancelling(false);
    }
  }

  async function handleUnschedule(id: string) {
    setUnscheduling(id);
    try {
      await updateCampaign(id, { scheduledAt: null });
      toast({ type: 'success', message: 'Campaña desprogramada: volvió a borrador' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'No se pudo desprogramar la campaña' });
    } finally {
      setUnscheduling(null);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteCampaign(id);
      toast({ type: 'success', message: 'Campaña eliminada correctamente' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al eliminar campaña' });
    } finally {
      setDeleting(null);
      setPendingDelete(null);
    }
  }

  // El envío masivo es irreversible: primero se pide confirmación, mostrando
  // la cantidad de destinatarios si se pudo calcular.
  function askSend(c: { id: string; name: string; channel: string }) {
    setPendingSend({ id: c.id, name: c.name, channel: c.channel });
    setPendingSendCount(null);
    campaignsApi
      .getRecipients(c.channel)
      .then((data) => setPendingSendCount(data.total))
      .catch(() => setPendingSendCount(null));
  }

  async function handleSend(id: string) {
    setSending(id);
    try {
      await sendCampaign(id);
      toast({ type: 'success', message: 'Campaña enviada correctamente' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al enviar campaña' });
    } finally {
      setSending(null);
      setPendingSend(null);
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
        <EmptyState
          icon={Megaphone}
          title="No hay campañas"
          description="Creá tu primera campaña para llegar a todos tus clientes."
          action={{ label: 'Crear campaña', onClick: openCreate }}
        />
      ) : (
        <div className="grid gap-4">
          {campaigns.map((c) => {
            const statusInfo = describeCampaignStatus({ ...c, failReason: failReasons[c.id] });
            // 'cancelled', 'sent' y 'sending' no se pueden enviar a mano (el server las rechaza).
            const canSend = c.status === 'draft' || c.status === 'scheduled' || c.status === 'failed';
            return (
              <div
                key={c.id}
                className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-white truncate">{c.name}</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-sm text-slate-400 mb-2 line-clamp-2">{c.description}</p>
                  )}
                  {statusInfo.description && (
                    <p className="text-xs text-slate-300 mb-2">{statusInfo.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {CHANNEL_LABELS[c.channel] || c.channel}
                    </span>
                    {c.scheduledAt && c.status === 'draft' && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        Hora programada: {formatArgentina(c.scheduledAt)} (hora de Argentina)
                      </span>
                    )}
                    <span>
                      Creada{' '}
                      {new Date(c.createdAt).toLocaleDateString('es-AR')}
                    </span>
                  </div>
                  {/*
                    Aperturas y clicks: no hay tracking (el backend guarda openRate/clickRate en 0),
                    así que no se muestran para no exhibir un "0 %" falso. Decisión del dueño pendiente.
                  */}
                  {c.status === 'sent' && (
                    <div className="flex items-center gap-4 mt-2 text-xs">
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Users className="h-3.5 w-3.5" />
                        {c.sentCount} enviados
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canSend && (
                    <>
                      <button
                        onClick={() => askSend(c)}
                        disabled={sending === c.id}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        {sending === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {c.status === 'failed' ? 'Reintentar envío' : 'Enviar ahora'}
                      </button>
                      {c.status === 'scheduled' && (
                        <button
                          onClick={() => handleUnschedule(c.id)}
                          disabled={unscheduling === c.id}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                        >
                          {unscheduling === c.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CalendarX className="h-3.5 w-3.5" />
                          )}
                          Desprogramar
                        </button>
                      )}
                      {c.status === 'scheduled' && (
                        <button
                          onClick={() => setPendingCancel({ id: c.id, name: c.name })}
                          className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Cancelar
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(c)}
                        aria-label="Editar campaña"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setPendingDelete({ id: c.id, name: c.name })}
                    aria-label="Eliminar campaña"
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
                    onChange={(e) => handleChannelChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="telegram">Telegram</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="campaign-schedule" className="block text-sm font-medium text-slate-300 mb-1">
                    Programar envío (hora de Argentina)
                  </label>
                  <input
                    id="campaign-schedule"
                    type="datetime-local"
                    value={form.scheduledAt}
                    min={isoToArgentinaInput(new Date())}
                    onChange={(e) => {
                      setForm({ ...form, scheduledAt: e.target.value });
                      setScheduleError(null);
                    }}
                    aria-invalid={scheduleError ? true : undefined}
                    aria-describedby="campaign-schedule-help"
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
              <p id="campaign-schedule-help" className="text-xs text-slate-500 -mt-2">
                Elegí una fecha y hora futuras, en hora de Argentina (GMT-3). Si la dejás vacía, la campaña queda
                como borrador y la enviás a mano con &quot;Enviar ahora&quot;.
                {editingStatus === 'scheduled' && ' Si la vaciás, se desprograma y vuelve a borrador.'}
              </p>
              {scheduleError && (
                <p role="alert" className="text-xs text-red-400 -mt-2">
                  {scheduleError}
                </p>
              )}

              {/* Audience preview */}
              <div className="rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-300">Audiencia estimada</span>
                </div>
                <div className="mt-1.5">
                  {loadingRecipients ? (
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Calculando destinatarios...
                    </span>
                  ) : recipientCount !== null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">{recipientCount}</span>
                      <span className="text-xs text-slate-400">
                        {recipientCount === 1 ? 'cliente recibirá' : 'clientes recibirán'} este mensaje por {CHANNEL_LABELS[form.channel] || form.channel}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">No se pudo obtener la audiencia</span>
                  )}
                  {recipientCount === 0 && (
                    <p className="text-[10px] text-amber-400 mt-1">
                      No hay clientes con datos de contacto para este canal. Verificá que tus clientes tengan {form.channel === 'email' ? 'email' : 'teléfono'} registrado.
                    </p>
                  )}
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

      <ConfirmDialog
        isOpen={pendingSend !== null}
        onClose={() => setPendingSend(null)}
        onConfirm={() => pendingSend && handleSend(pendingSend.id)}
        title="¿Enviar campaña?"
        message={
          pendingSend
            ? `Vas a enviar "${pendingSend.name}" por ${CHANNEL_LABELS[pendingSend.channel] || pendingSend.channel}` +
              (pendingSendCount !== null
                ? ` a ${pendingSendCount} ${pendingSendCount === 1 ? 'cliente' : 'clientes'}.`
                : ' a todos los clientes con datos de contacto para ese canal.') +
              ' El envío no se puede deshacer.'
            : ''
        }
        confirmLabel="Enviar ahora"
        variant="warning"
        loading={pendingSend !== null && sending === pendingSend.id}
      />

      <ConfirmDialog
        isOpen={pendingCancel !== null}
        onClose={() => setPendingCancel(null)}
        onConfirm={() => pendingCancel && handleCancel(pendingCancel.id)}
        title="¿Cancelar la campaña?"
        message={`La campaña "${pendingCancel?.name ?? ''}" no se va a enviar a la hora programada ni después. Una campaña cancelada no se puede enviar. Si solo querés cambiar la hora, usá "Desprogramar" o editala.`}
        confirmLabel="Sí, cancelar campaña"
        cancelLabel="Volver"
        variant="danger"
        loading={cancelling}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete.id)}
        title="¿Eliminar campaña?"
        message={`Vas a eliminar la campaña "${pendingDelete?.name ?? ''}". Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={pendingDelete !== null && deleting === pendingDelete.id}
      />
    </div>
  );
}
