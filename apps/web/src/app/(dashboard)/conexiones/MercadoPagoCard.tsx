'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import {
  getMpStatus,
  connectMp,
  disconnectMp,
  type MpStatus,
} from '@/lib/api/mercadopago';

// ────────────────────────────────────────────────────────────────
// Componente: Tarjeta de conexion MercadoPago (pagos / Checkout Pro, funcional)
// Imita el patrón de CalcomCard.
// ────────────────────────────────────────────────────────────────

export function MercadoPagoCard() {
  const { toast } = useToast();

  const [status, setStatus] = useState<MpStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState('');
  const [currency, setCurrency] = useState('ARS');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = status?.connected ?? false;

  const loadStatus = useCallback(async () => {
    try {
      const data = await getMpStatus();
      setStatus(data);
    } catch {
      toast({ type: 'error', message: 'No se pudo cargar el estado de MercadoPago' });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = async () => {
    const token = accessToken.trim();
    if (!token) return;
    setIsConnecting(true);
    try {
      // La moneda es opcional: solo la mandamos si difiere del default.
      const cur = currency.trim().toUpperCase();
      const newStatus = await connectMp(token, cur && cur !== 'ARS' ? cur : undefined);
      setStatus(newStatus);
      setAccessToken('');
      toast({ type: 'success', message: 'MercadoPago conectado exitosamente' });
    } catch (err) {
      // El backend responde 400 ("access token inválido") ante un token incorrecto.
      const message = err instanceof Error ? err.message : 'Access token inválido';
      toast({ type: 'error', message });
    }
    setIsConnecting(false);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const newStatus = await disconnectMp();
      setStatus(newStatus);
      setCurrency('ARS');
      toast({ type: 'success', message: 'MercadoPago desconectado' });
    } catch {
      toast({ type: 'error', message: 'Error al desconectar MercadoPago' });
    }
    setIsDisconnecting(false);
  };

  return (
    <div className="card-accent p-6 border border-brand-400/20">
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400/10">
            <CreditCard className="h-6 w-6 text-brand-400" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">MercadoPago</h4>
            <p className="text-xs text-slate-400">Cobrá con Checkout Pro — links de pago para tus clientes</p>
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

      {/* Estado desconectado: form para el access token + moneda */}
      {!isLoading && !isConnected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Access Token de MercadoPago</label>
            <input
              type="text"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="APP_USR-..."
              className="input w-full font-mono text-sm"
              disabled={isConnecting}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
          </div>
          <div className="flex gap-2">
            <div className="w-28">
              <label className="block text-xs text-slate-400 mb-1.5">Moneda</label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="ARS"
                maxLength={3}
                className="input w-full font-mono text-sm uppercase"
                disabled={isConnecting}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
            </div>
            <div className="flex-1 flex items-end">
              <button
                onClick={handleConnect}
                className="btn-primary w-full"
                disabled={isConnecting || !accessToken.trim()}
              >
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Conectar'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Obtené tu access token desde{' '}
            <a
              href="https://www.mercadopago.com.ar/developers/panel/app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:underline inline-flex items-center gap-1"
            >
              el panel de desarrolladores de MercadoPago <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      )}

      {/* Estado conectado */}
      {!isLoading && isConnected && (
        <div className="space-y-4">
          <div className="bg-surface-100 rounded-lg p-4">
            <p className="text-sm text-white font-medium">Cuenta de MercadoPago conectada</p>
            <p className="text-xs text-slate-400 mt-1">
              Moneda configurada: {status?.currency ?? 'ARS'}
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
