'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Send,
  MessageCircle,
  Instagram,
  Facebook,
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Copy,
  CalendarIcon,
  CreditCard,
  Mail,
  Link2,
  Webhook,
  Plus,
  X,
  Trash2,
  Play,
  Edit2,
} from 'lucide-react';
import { useConnections } from '@/hooks/use-connections';
import { useBots } from '@/hooks/use-bots';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import * as webhooksApi from '@/lib/api/webhooks';
import type { Webhook as WebhookType } from '@/lib/api/webhooks';

// ────────────────────────────────────────────────────────────────
// Canales de comunicación adicionales (proximamente)
// ────────────────────────────────────────────────────────────────

const upcomingChannels = [
  { name: 'WhatsApp', icon: MessageCircle, color: 'text-green-400', description: 'Conecta WhatsApp Business API' },
  { name: 'Instagram', icon: Instagram, color: 'text-pink-400', description: 'Mensajes directos de Instagram' },
  { name: 'Messenger', icon: Facebook, color: 'text-blue-500', description: 'Facebook Messenger para negocios' },
  { name: 'Web Chat', icon: Globe, color: 'text-brand-400', description: 'Widget de chat para tu sitio web' },
];

const integrations = [
  { name: 'Google Calendar', category: 'Agenda', icon: CalendarIcon, status: 'available' },
  { name: 'Cal.com', category: 'Agenda', icon: CalendarIcon, status: 'available' },
  { name: 'Calendly', category: 'Agenda', icon: CalendarIcon, status: 'available' },
  { name: 'Stripe', category: 'Pagos', icon: CreditCard, status: 'available' },
  { name: 'MercadoPago', category: 'Pagos', icon: CreditCard, status: 'available' },
  { name: 'Clip.mx', category: 'Pagos', icon: CreditCard, status: 'available' },
  { name: 'Mailchimp', category: 'Email', icon: Mail, status: 'available' },
  { name: 'SendGrid', category: 'Email', icon: Mail, status: 'available' },
  { name: 'HubSpot', category: 'CRM', icon: Link2, status: 'available' },
  { name: 'Notion', category: 'Productividad', icon: Link2, status: 'available' },
  { name: 'Google Sheets', category: 'Productividad', icon: Link2, status: 'available' },
  { name: 'Zapier', category: 'Automatizacion', icon: Link2, status: 'available' },
  { name: 'Make', category: 'Automatizacion', icon: Link2, status: 'available' },
  { name: 'n8n', category: 'Automatizacion', icon: Link2, status: 'available' },
  { name: 'Composio', category: 'Automatizacion', icon: Link2, status: 'available' },
];

// ────────────────────────────────────────────────────────────────
// Componente: Web Chat Widget embebible
// ────────────────────────────────────────────────────────────────

function WebChatWidgetCard() {
  const { bots } = useBots();
  const [selectedBotId, setSelectedBotId] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [widgetColor, setWidgetColor] = useState('#0EA5E9');

  const activeBots = bots.filter((b) => b.status === 'ACTIVE');
  const botId = selectedBotId || activeBots[0]?.id || '';

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio.com';

  const widgetScript = `<script src="${origin}/widget.js" data-bot-id="${botId}" data-color="${widgetColor}" defer></script>`;
  const iframeCode = `<iframe src="${origin}/chat/${botId}" width="400" height="600" frameborder="0" style="border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.2)"></iframe>`;

  function copyCode(code: string, type: string) {
    navigator.clipboard.writeText(code);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="card-accent p-6 border border-brand-400/20">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400/10">
            <Globe className="h-6 w-6 text-brand-400" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">Web Chat Widget</h4>
            <p className="text-xs text-slate-400">Agregá un botón de chat flotante en tu sitio web</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          Listo
        </span>
      </div>

      {activeBots.length === 0 ? (
        <div className="bg-surface-100 rounded-lg p-4 text-center">
          <p className="text-sm text-slate-400">Necesitás al menos un bot activo para generar el código.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Bot</label>
              <select
                value={botId}
                onChange={(e) => setSelectedBotId(e.target.value)}
                className="input w-full"
              >
                {activeBots.map((bot) => (
                  <option key={bot.id} value={bot.id}>{bot.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Color del botón</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={widgetColor}
                  onChange={(e) => setWidgetColor(e.target.value)}
                  className="h-9 w-9 rounded border border-slate-700 bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={widgetColor}
                  onChange={(e) => setWidgetColor(e.target.value)}
                  className="input flex-1 font-mono text-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-500">Widget flotante (recomendado)</label>
              <button
                onClick={() => copyCode(widgetScript, 'widget')}
                className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
              >
                {copied === 'widget' ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === 'widget' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="bg-[#0B0F14] rounded-lg p-3 text-xs text-slate-300 font-mono overflow-x-auto border border-slate-800">
              {widgetScript}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-500">Iframe embebido</label>
              <button
                onClick={() => copyCode(iframeCode, 'iframe')}
                className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
              >
                {copied === 'iframe' ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === 'iframe' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="bg-[#0B0F14] rounded-lg p-3 text-xs text-slate-300 font-mono overflow-x-auto border border-slate-800">
              {iframeCode}
            </pre>
          </div>

          <p className="text-[10px] text-slate-600">
            Pegá el código antes del cierre de {'</body>'} en tu sitio web. El widget aparece como un botón flotante en la esquina inferior.
          </p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Componente: Tarjeta de conexion Telegram
// ────────────────────────────────────────────────────────────────

function TelegramCard() {
  const {
    telegramStatus,
    isTelegramLoading,
    telegramError,
    connectTelegram,
    disconnectTelegram,
  } = useConnections();

  const [botToken, setBotToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isConnected = telegramStatus?.connected ?? false;

  const handleConnect = async () => {
    if (!botToken.trim()) return;
    setIsConnecting(true);
    setSuccessMessage(null);
    const success = await connectTelegram(botToken.trim());
    setIsConnecting(false);
    if (success) {
      setBotToken('');
      setShowTokenInput(false);
      setSuccessMessage('Bot conectado exitosamente');
      setTimeout(() => setSuccessMessage(null), 5000);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    await disconnectTelegram();
    setIsDisconnecting(false);
  };

  return (
    <div className="card-accent p-6 border border-blue-500/20">
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
            <Send className="h-6 w-6 text-blue-400" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">Telegram</h4>
            <p className="text-xs text-slate-400">El canal mas facil de conectar — 5 min, gratis</p>
          </div>
        </div>
        {isTelegramLoading ? (
          <Loader2 className="h-5 w-5 text-slate-400 animate-spin" />
        ) : isConnected ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Conectado
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <XCircle className="h-4 w-4" />
            Desconectado
          </span>
        )}
      </div>

      {/* Estado conectado */}
      {isConnected && telegramStatus?.bot && (
        <div className="bg-surface-100 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">
                @{telegramStatus.bot.username}
              </p>
              <p className="text-xs text-slate-400">
                {telegramStatus.bot.name}
              </p>
              {telegramStatus.bot.connectedAt && (
                <p className="text-xs text-slate-500 mt-1">
                  Conectado desde {new Date(telegramStatus.bot.connectedAt).toLocaleDateString('es-AR')}
                </p>
              )}
            </div>
            <a
              href={`https://t.me/${telegramStatus.bot.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              Abrir bot <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* Mensajes de error y exito */}
      {telegramError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-400">{telegramError}</p>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 mb-4">
          <p className="text-sm text-emerald-400">{successMessage}</p>
        </div>
      )}

      {/* Formulario de conexion */}
      {!isConnected && !showTokenInput && (
        <div>
          <button
            onClick={() => setShowTokenInput(true)}
            className="btn-primary w-full"
            disabled={isTelegramLoading}
          >
            Conectar bot de Telegram
          </button>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">Pasos para conectar:</p>
            <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1">
              <li>Abri <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">@BotFather</a> en Telegram</li>
              <li>Envia <code className="bg-surface-100 px-1 py-0.5 rounded text-slate-300">/newbot</code> y segui las instrucciones</li>
              <li>Copia el token que te da BotFather</li>
              <li>Pega el token aca abajo</li>
            </ol>
          </div>
        </div>
      )}

      {!isConnected && showTokenInput && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Token del bot (de BotFather)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHI..."
                className="input flex-1 font-mono text-sm"
                disabled={isConnecting}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                onClick={handleConnect}
                className="btn-primary px-4"
                disabled={isConnecting || !botToken.trim()}
              >
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Conectar'
                )}
              </button>
            </div>
          </div>
          <button
            onClick={() => { setShowTokenInput(false); setBotToken(''); }}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Boton de desconexion */}
      {isConnected && (
        <button
          onClick={handleDisconnect}
          className="btn-secondary w-full text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40"
          disabled={isDisconnecting}
        >
          {isDisconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
          ) : (
            'Desconectar bot'
          )}
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Componente: Webhooks
// ────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  'booking.created': 'Reserva creada',
  'booking.updated': 'Reserva actualizada',
  'booking.cancelled': 'Reserva cancelada',
  'order.created': 'Orden creada',
  'order.updated': 'Orden actualizada',
  'client.created': 'Cliente creado',
  'transaction.created': 'Transacción creada',
  'conversation.new_message': 'Nuevo mensaje',
  'campaign.sent': 'Campaña enviada',
};

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookType | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean } | null>(null);

  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await webhooksApi.getWebhooks();
      setWebhooks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los webhooks');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormUrl('');
    setFormSecret('');
    setFormEvents([]);
    setShowForm(true);
  }

  function openEdit(w: WebhookType) {
    setEditing(w);
    setFormName(w.name);
    setFormUrl(w.url);
    setFormSecret(w.secret || '');
    setFormEvents(w.events || []);
    setShowForm(true);
  }

  function toggleEvent(event: string) {
    setFormEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  async function handleSave() {
    if (!formName.trim() || !formUrl.trim() || formEvents.length === 0) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = await webhooksApi.updateWebhook(editing.id, {
          name: formName,
          url: formUrl,
          events: formEvents,
          secret: formSecret || undefined,
        });
        setWebhooks((prev) => prev.map((w) => (w.id === editing.id ? updated : w)));
      } else {
        const created = await webhooksApi.createWebhook({
          name: formName,
          url: formUrl,
          events: formEvents,
          secret: formSecret || undefined,
        });
        setWebhooks((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await webhooksApi.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setDeleteTarget(null);
    } catch { /* ignore */ }
    setDeleting(false);
  }

  async function handleToggle(w: WebhookType) {
    try {
      const updated = await webhooksApi.updateWebhook(w.id, { isActive: !w.isActive });
      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    } catch { /* ignore */ }
  }

  async function handleTest(id: string) {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await webhooksApi.testWebhook(id);
      setTestResult({ id, ok: result.success });
    } catch {
      setTestResult({ id, ok: false });
    }
    setTesting(null);
    setTimeout(() => setTestResult(null), 4000);
  }

  if (isLoading) return <LoadingSpinner label="Cargando conexiones..." />;

  return (
    <div>
      {error && <ErrorAlert message={error} className="mb-4" />}
      <div className="flex items-center justify-between mb-4">
        <h3 className="mono-label">WEBHOOKS</h3>
        <button onClick={openCreate} className="btn-secondary text-xs">
          <Plus className="h-3.5 w-3.5" /> Nuevo webhook
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-brand-400/30 bg-slate-800/50 p-4 space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">
              {editing ? 'Editar webhook' : 'Nuevo webhook'}
            </h4>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej: Zapier — Reservas" className="input w-full" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">URL del endpoint *</label>
              <input type="url" value={formUrl} onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://hooks.zapier.com/..." className="input w-full font-mono text-xs" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Secret (opcional)</label>
            <input type="text" value={formSecret} onChange={(e) => setFormSecret(e.target.value)}
              placeholder="Se enviará en el header X-Webhook-Secret" className="input w-full font-mono text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Eventos *</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(EVENT_LABELS).map(([event, label]) => (
                <button key={event} type="button" onClick={() => toggleEvent(event)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                    formEvents.includes(event)
                      ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                      : 'text-slate-500 border-slate-700 hover:text-white hover:border-slate-600'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-xs">Cancelar</button>
            <button onClick={handleSave}
              disabled={saving || !formName.trim() || !formUrl.trim() || formEvents.length === 0}
              className="btn-primary text-xs disabled:opacity-50">
              {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear webhook'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { handleDelete(deleteTarget); } setDeleteTarget(null); }}
        title="Eliminar webhook"
        message="¿Eliminar este webhook?"
        confirmLabel="Eliminar"
        variant="danger"
      />

      {webhooks.length === 0 && !showForm ? (
        <div className="card text-center py-8">
          <Webhook className="h-8 w-8 text-slate-700 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-1">Sin webhooks configurados</p>
          <p className="text-xs text-slate-600 mb-3">
            Conecta Zapier, Make, n8n o cualquier servicio que acepte webhooks
          </p>
          <button onClick={openCreate} className="btn-primary text-xs mx-auto">
            <Plus className="h-3.5 w-3.5" /> Crear primer webhook
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {webhooks.map((w) => (
            <div key={w.id} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
              <div className="flex items-center gap-3">
                <button onClick={() => handleToggle(w)}
                  className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${w.isActive ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${w.isActive ? 'right-0.5' : 'left-0.5'}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{w.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{w.url}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {testResult?.id === w.id && (
                    <span className={`text-[10px] ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.ok ? 'OK' : 'Error'}
                    </span>
                  )}
                  <button onClick={() => handleTest(w.id)} disabled={testing === w.id}
                    className="btn-secondary text-[10px] py-1 px-2">
                    {testing === w.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Test
                  </button>
                  <button onClick={() => openEdit(w)} className="btn-secondary text-[10px] py-1 px-2">
                    <Edit2 className="h-3 w-3" />
                  </button>
                  <button onClick={() => setDeleteTarget(w.id)}
                    className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(w.events || []).map((event) => (
                  <span key={event} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-700/50 text-slate-400">
                    {EVENT_LABELS[event] || event}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Pagina principal de Conexiones
// ────────────────────────────────────────────────────────────────

export default function ConexionesPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-400 mb-6 max-w-2xl">
          Conecta tus canales de comunicacion y herramientas favoritas. Cada canal es una puerta de
          entrada para tus clientes — cada integracion, un puente con tus herramientas.
        </p>

        <h3 className="mono-label mb-4">CANALES DE COMUNICACION</h3>

        {/* Telegram — canal principal, funcional */}
        <div className="mb-4">
          <TelegramCard />
        </div>

        {/* Web Chat Widget */}
        <div className="mb-4">
          <WebChatWidgetCard />
        </div>

        {/* Otros canales — proximamente */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {upcomingChannels.map((channel) => {
            const Icon = channel.icon;
            return (
              <div key={channel.name} className="card-accent text-center opacity-60">
                <Icon className={`h-8 w-8 ${channel.color} mx-auto mb-3`} />
                <h4 className="font-medium text-white mb-1">{channel.name}</h4>
                <p className="text-[10px] text-slate-500 mb-3">{channel.description}</p>
                <span className="inline-block text-[10px] font-mono uppercase tracking-wider text-slate-600 bg-surface-100 px-2 py-1 rounded">
                  Proximamente
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <WebhooksSection />

      <div>
        <h3 className="mono-label mb-4">INTEGRACIONES</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {integrations.map((integration) => {
            const Icon = integration.icon;
            return (
              <div key={integration.name} className="card flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-100">
                  <Icon className="h-5 w-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{integration.name}</p>
                  <p className="text-[10px] font-mono text-slate-500 uppercase">{integration.category}</p>
                </div>
                <button className="btn-secondary text-xs py-1 px-2">
                  Conectar
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
