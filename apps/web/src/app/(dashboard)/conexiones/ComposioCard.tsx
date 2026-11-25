'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import {
  getCmpStatus,
  connectCmp,
  disconnectCmp,
  type CmpStatus,
} from '@/lib/api/composio';

// ────────────────────────────────────────────────────────────────
// Componente: Tarjeta de conexion Composio (funcional)
// Imita el patrón de ManyChatCard / MercadoPagoCard, pero sin webhook
// (Composio no expone un canal entrante).
// ────────────────────────────────────────────────────────────────

export function ComposioCard() {
  const { toast } = useToast();

  const [status, setStatus] = useState<CmpStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = status?.connected ?? false;

  const loadStatus = useCallback(async () => {
    try {
      const data = await getCmpStatus();
      setStatus(data);
    } catch {
      toast({ type: 'error', message: 'No se pudo cargar el estado de Composio' });
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
      const newStatus = await connectCmp(key);
      setStatus(newStatus);
      setApiKey('');
      toast({ type: 'success', message: 'Composio conectado exitosamente' });
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
      const newStatus = await disconnectCmp();
      setStatus(newStatus);
      toast({ type: 'success', message: 'Composio desconectado' });
    } catch {
      toast({ type: 'error', message: 'Error al desconectar Composio' });
    }
    setIsDisconnecting(false);
  };

  return (
    <div className="card-accent p-6 border border-brand-400/20">
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400/10">
            <Plug className="h-6 w-6 text-brand-400" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">Composio</h4>
            <p className="text-xs text-slate-400">Conectá 250+ apps y herramientas a tu bot vía Composio</p>
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
            <label className="block text-xs text-slate-400 mb-1.5">API key de Composio</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="comp_..."
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
              href="https://composio.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:underline inline-flex items-center gap-1"
            >
              Composio (Settings → API Keys) <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      )}

      {/* Estado conectado */}
      {!isLoading && isConnected && (
        <div className="space-y-4">
          <div className="bg-surface-100 rounded-lg p-4">
            <p className="text-sm text-white font-medium">Cuenta de Composio conectada</p>
            <p className="text-xs text-slate-400 mt-1">
              Tus apps y herramientas de Composio ya pueden integrarse con el bot
            </p>
          </div>

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
