'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api/http-client';
import {
  getMcStatus,
  connectMc,
  disconnectMc,
  regenerateMcToken,
  type McStatus,
} from '@/lib/api/manychat';

// ────────────────────────────────────────────────────────────────
// Componente: Tarjeta de conexion ManyChat (funcional)
// Imita el patrón de MercadoPagoCard / CalcomCard.
// ────────────────────────────────────────────────────────────────

export function ManyChatCard() {
  const { toast } = useToast();
  const { business } = useAuth();

  const [status, setStatus] = useState<McStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copied, setCopied] = useState<'url' | 'token' | null>(null);

  const isConnected = status?.connected ?? false;

  // URL pública que ManyChat debe llamar (External Request). API_URL ya termina
  // en /api, así que sumamos la ruta del webhook con el id del negocio.
  const webhookUrl = business?.id ? `${API_URL}/manychat/webhook/${business.id}` : '';

  const copy = (value: string, which: 'url' | 'token') => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const newStatus = await regenerateMcToken();
      setStatus(newStatus);
      toast({ type: 'success', message: 'Token del webhook regenerado' });
    } catch {
      toast({ type: 'error', message: 'No se pudo regenerar el token' });
    }
    setIsRegenerating(false);
  };

  const loadStatus = useCallback(async () => {
    try {
      const data = await getMcStatus();
      setStatus(data);
    } catch {
      toast({ type: 'error', message: 'No se pudo cargar el estado de ManyChat' });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setIsConnecting(true);
    try {
      const newStatus = await connectMc(key);
      setStatus(newStatus);
      setApiKey('');
      toast({ type: 'success', message: 'ManyChat conectado exitosamente' });
    } catch (err) {
      // El backend responde 400 ("API key inválida") ante una key incorrecta.
      const message = err instanceof Error ? err.message : 'API key inválida';
      toast({ type: 'error', message });
    }
    setIsConnecting(false);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const newStatus = await disconnectMc();
      setStatus(newStatus);
      toast({ type: 'success', message: 'ManyChat desconectado' });
    } catch {
      toast({ type: 'error', message: 'Error al desconectar ManyChat' });
    }
    setIsDisconnecting(false);
  };

  return (
    <div className="card-accent p-6 border border-brand-400/20">
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400/10">
            <MessageCircle className="h-6 w-6 text-brand-400" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">ManyChat</h4>
            <p className="text-xs text-slate-400">Automatizá conversaciones en tus canales de ManyChat</p>
          </div>
        </div>
        {isLoading ? (
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

      {/* Estado desconectado: form para la API key */}
      {!isLoading && !isConnected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">API key de ManyChat</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="1234567:abcdef..."
                className="input flex-1 font-mono text-sm"
                disabled={isConnecting}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <button
                onClick={handleConnect}
                className="btn-primary px-4"
                disabled={isConnecting || !apiKey.trim()}
              >
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Conectar'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Obtené tu API key desde{' '}
            <a
              href="https://manychat.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:underline inline-flex items-center gap-1"
            >
              ManyChat (Settings → API) <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      )}

      {/* Estado conectado */}
      {!isLoading && isConnected && (
        <div className="space-y-4">
          <div className="bg-surface-100 rounded-lg p-4">
            <p className="text-sm text-white font-medium">Cuenta de ManyChat conectada</p>
            <p className="text-xs text-slate-400 mt-1">
              Tus flujos de ManyChat ya pueden integrarse con el bot
            </p>
          </div>

          {/* Webhook entrante: convierte a ManyChat en un canal real del bot.
              El usuario configura en ManyChat una acción "External Request" con
              esta URL (POST) y el token como header x-webhook-token. */}
          {status?.webhookToken && (
            <div className="bg-surface-100 rounded-lg p-4 space-y-3">
              <div>
                <p className="text-sm text-white font-medium">Webhook entrante (canal bidireccional)</p>
                <p className="text-xs text-slate-400 mt-1">
                  En ManyChat creá una acción <span className="text-slate-300">External Request</span> (POST) con esta URL y el token.
                  Las respuestas del bot vuelven en formato Dynamic Block.
                </p>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">URL del webhook</label>
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
                  <code className="flex-1 text-xs text-slate-200 break-all">{webhookUrl}</code>
                  <button onClick={() => copy(webhookUrl, 'url')} className="text-slate-400 hover:text-white transition shrink-0" title="Copiar URL" type="button">
                    {copied === 'url' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Token (header <code>x-webhook-token</code>)</label>
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
                  <code className="flex-1 text-xs text-slate-200 break-all">{status.webhookToken}</code>
                  <button onClick={() => copy(status.webhookToken!, 'token')} className="text-slate-400 hover:text-white transition shrink-0" title="Copiar token" type="button">
                    {copied === 'token' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition disabled:opacity-50"
              >
                {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Regenerar token
              </button>
            </div>
          )}

          <button
            onClick={handleDisconnect}
            className="btn-secondary w-full text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40"
            disabled={isDisconnecting}
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            ) : (
              'Desconectar'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
