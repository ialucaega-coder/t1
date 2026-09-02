'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import { useConnections } from '@/hooks/use-connections';
import { useBots } from '@/hooks/use-bots';

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
