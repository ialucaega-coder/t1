'use client';

import { useState, useEffect, useCallback } from 'react';
import { Instagram, Facebook, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { metaApi } from '@/lib/api/index';
import type { MetaPlatform, MetaPlatformStatus } from '@/lib/api/meta';
import { useToast } from '@/components/common/Toast';

// ────────────────────────────────────────────────────────────────
// Tarjeta de conexión para un canal de Meta (Instagram o Messenger).
//
// Ambos comparten la misma Graph API; lo único que cambia es qué id
// pide (igId para Instagram, pageId para Messenger) y el copy. El bot
// del negocio queda conectado y responde con el mismo cerebro IA.
// ────────────────────────────────────────────────────────────────

interface MetaChannelCardProps {
  platform: MetaPlatform;
}

const CONFIG = {
  instagram: {
    label: 'Instagram',
    subtitle: 'Mensajes directos de Instagram, respondidos por tu bot',
    Icon: Instagram,
    accent: 'text-pink-400',
    ring: 'border-pink-500/20',
    bg: 'bg-pink-500/10',
    idLabel: 'ID de la cuenta de Instagram (IG Business ID)',
    idField: 'igId' as const,
    idPlaceholder: '17841400000000000',
    steps: [
      'Vinculá tu cuenta de Instagram Business a una página de Facebook',
      'Creá una app en developers.facebook.com y agregá el producto "Instagram"',
      'Generá un Page Access Token con permisos de mensajería de Instagram',
      'Pegá el IG Business ID y el token acá abajo',
    ],
  },
  messenger: {
    label: 'Messenger',
    subtitle: 'Facebook Messenger para tu página, atendido por tu bot',
    Icon: Facebook,
    accent: 'text-blue-500',
    ring: 'border-blue-500/20',
    bg: 'bg-blue-500/10',
    idLabel: 'ID de la página de Facebook (Page ID)',
    idField: 'pageId' as const,
    idPlaceholder: '102000000000000',
    steps: [
      'Creá una app en developers.facebook.com y agregá el producto "Messenger"',
      'Suscribí tu página a la app y generá un Page Access Token',
      'Configurá el webhook apuntando a /api/meta/webhook con tu verify token',
      'Pegá el Page ID y el token acá abajo',
    ],
  },
};

export function MetaChannelCard({ platform }: MetaChannelCardProps) {
  const cfg = CONFIG[platform];
  const { Icon } = cfg;
  const { toast } = useToast();

  const [status, setStatus] = useState<MetaPlatformStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [idValue, setIdValue] = useState('');
  const [token, setToken] = useState('');
  const [pageName, setPageName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const s = await metaApi.getMetaStatus();
      setStatus(s[platform]);
    } catch {
      setStatus({ connected: false });
    }
    setIsLoading(false);
  }, [platform]);

  useEffect(() => { load(); }, [load]);

  const connected = status?.connected ?? false;

  async function handleConnect() {
    if (!idValue.trim() || !token.trim()) return;
    setBusy(true);
    try {
      await metaApi.connectMeta({
        platform,
        pageAccessToken: token.trim(),
        [cfg.idField]: idValue.trim(),
        pageName: pageName.trim() || undefined,
      });
      toast({ type: 'success', message: `${cfg.label} conectado correctamente` });
      setShowForm(false);
      setIdValue('');
      setToken('');
      setPageName('');
      await load();
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : `Error al conectar ${cfg.label}` });
    }
    setBusy(false);
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await metaApi.disconnectMeta(platform);
      toast({ type: 'success', message: `${cfg.label} desconectado` });
      await load();
    } catch {
      toast({ type: 'error', message: `Error al desconectar ${cfg.label}` });
    }
    setBusy(false);
  }

  return (
    <div className={`card-accent p-6 border ${cfg.ring}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${cfg.bg}`}>
            <Icon className={`h-6 w-6 ${cfg.accent}`} />
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">{cfg.label}</h4>
            <p className="text-xs text-slate-400">{cfg.subtitle}</p>
          </div>
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 text-slate-400 animate-spin" />
        ) : connected ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Conectado
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <XCircle className="h-4 w-4" /> Desconectado
          </span>
        )}
      </div>

      {connected && (
        <div className="bg-surface-100 rounded-lg p-4 mb-4">
          <p className="text-sm text-white font-medium">{status?.name || cfg.label}</p>
          <p className="text-xs text-slate-400 font-mono">
            {cfg.idField === 'igId' ? status?.igId : status?.pageId}
          </p>
          {status?.connectedAt && (
            <p className="text-xs text-slate-500 mt-1">
              Conectado desde {new Date(status.connectedAt).toLocaleDateString('es-AR')}
            </p>
          )}
        </div>
      )}

      {!connected && !showForm && (
        <div>
          <button onClick={() => setShowForm(true)} className="btn-primary w-full" disabled={isLoading}>
            Conectar {cfg.label}
          </button>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">Pasos para conectar:</p>
            <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1">
              {cfg.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        </div>
      )}

      {!connected && showForm && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{cfg.idLabel}</label>
            <input
              type="text"
              value={idValue}
              onChange={(e) => setIdValue(e.target.value)}
              placeholder={cfg.idPlaceholder}
              className="input w-full font-mono text-sm"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Page Access Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAG..."
              className="input w-full font-mono text-sm"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Nombre (opcional)</label>
            <input
              type="text"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              placeholder={`Mi cuenta de ${cfg.label}`}
              className="input w-full text-sm"
              disabled={busy}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleConnect} className="btn-primary flex-1" disabled={busy || !idValue.trim() || !token.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Conectar'}
            </button>
            <button
              onClick={() => { setShowForm(false); setIdValue(''); setToken(''); setPageName(''); }}
              className="btn-secondary text-xs"
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {connected && (
        <button
          onClick={handleDisconnect}
          className="btn-secondary w-full text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40"
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : `Desconectar ${cfg.label}`}
        </button>
      )}
    </div>
  );
}
