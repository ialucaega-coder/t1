'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Cpu, Sparkles, Eye, Bot, Zap, Rocket, Brain, Wind, Users, Compass,
  MessageSquare, Server, KeyRound, X, Loader2, CheckCircle2, Check,
  type LucideIcon,
} from 'lucide-react';
import * as aiApi from '@/lib/api/ai';
import type { AIEngineStatus } from '@/lib/api/ai';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

// Mapa de iconos que el backend referencia por nombre (catalog.ts).
const ICONS: Record<string, LucideIcon> = {
  Sparkles, Eye, Bot, Zap, Rocket, Brain, Wind, Users, Compass, MessageSquare, Server, Cpu,
};

// Nombre lindo por familia de proveedor (para el modal de API keys).
const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic (Claude)', gemini: 'Google Gemini',
  groq: 'Groq', deepseek: 'DeepSeek', mistral: 'Mistral', together: 'Together AI',
  perplexity: 'Perplexity', cohere: 'Cohere',
};

export function MotorDeIA() {
  const { toast } = useToast();
  const [data, setData] = useState<aiApi.EnginesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await aiApi.getEngines());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el Motor de IA');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeEngine = useMemo(
    () => data?.engines.find((e) => e.id === data.activeEngineId),
    [data],
  );

  async function activate(engine: AIEngineStatus) {
    if (engine.active || switching) return;
    setSwitching(engine.id);
    try {
      await aiApi.setEngine(engine.id);
      setData((prev) => prev && {
        activeEngineId: engine.id,
        engines: prev.engines.map((e) => ({ ...e, active: e.id === engine.id })),
      });
      toast({ type: 'success', message: `Motor cambiado a ${engine.name}` });
      if (!engine.ready) {
        toast({ type: 'info', message: `${engine.name} necesita una API key para funcionar` });
      }
    } catch {
      toast({ type: 'error', message: 'No se pudo cambiar el motor' });
    }
    setSwitching(null);
  }

  if (loading) return <LoadingSpinner label="Cargando Motor de IA..." />;
  if (error) return <ErrorAlert message={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="mono-label">MOTOR DE IA</span>
          {activeEngine && (
            <span className="text-brand-400 font-semibold text-sm">— {activeEngine.name}</span>
          )}
        </div>
        <button onClick={() => setShowKeys(true)} className="btn-secondary text-xs flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" /> API Keys
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {data.engines.map((engine) => {
          const Icon = ICONS[engine.icon || 'Cpu'] || Cpu;
          const isSwitching = switching === engine.id;
          return (
            <button
              key={engine.id}
              onClick={() => activate(engine)}
              disabled={isSwitching}
              className={`text-left rounded-xl border p-3 transition-colors relative ${
                engine.active
                  ? 'border-brand-400/60 bg-brand-400/10'
                  : 'border-slate-700/60 bg-slate-800/30 hover:border-slate-600'
              }`}
            >
              {engine.active && (
                <span className="absolute top-2 right-2 badge-active text-[9px] flex items-center gap-0.5">
                  <CheckCircle2 className="h-2.5 w-2.5" /> ACTIVO
                </span>
              )}
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`h-4 w-4 ${engine.active ? 'text-brand-400' : 'text-slate-400'}`} />
                <span className="text-sm font-medium text-white leading-tight">{engine.name}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide">
                <span className="text-slate-500">{engine.local ? 'Local' : 'API'}</span>
                <span className="text-slate-700">·</span>
                <StatusPill engine={engine} />
                {engine.vision && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="text-sky-400 flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />fotos</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 mt-3">
        Elegí el modelo que responde a tus clientes. Cargá tu propia API key en cada proveedor, o usá los
        que ya tienen <span className="text-blue-400">relay</span> configurado. Los modelos locales
        (Ollama / LM Studio) corren en tu servidor, sin key.
      </p>

      {showKeys && (
        <ApiKeysModal
          engines={data.engines}
          onClose={() => setShowKeys(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}

/** Indicador de estado de key: propia (verde), relay (azul), local (verde), sin key (rojo). */
function StatusPill({ engine }: { engine: AIEngineStatus }) {
  if (engine.local) return <span className="text-emerald-400">Key OK</span>;
  if (engine.hasOwnKey) return <span className="text-emerald-400">Key propia</span>;
  if (engine.relayAvailable) return <span className="text-blue-400">relay</span>;
  return <span className="text-red-400">Sin key</span>;
}

/** Modal para cargar API keys por familia de proveedor. */
function ApiKeysModal({
  engines,
  onClose,
  onSaved,
}: {
  engines: AIEngineStatus[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // Familias de proveedor que usan API key (excluye locales), sin duplicar.
  const providers = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const e of engines) {
      if (e.type === 'local' || e.provider === 'ollama' || e.provider === 'lmstudio') continue;
      if (!seen.has(e.provider)) seen.set(e.provider, e.hasOwnKey);
      else if (e.hasOwnKey) seen.set(e.provider, true);
    }
    return [...seen.entries()].map(([provider, hasKey]) => ({ provider, hasKey }));
  }, [engines]);

  async function save(provider: string) {
    const apiKey = (values[provider] || '').trim();
    if (!apiKey) return;
    setSaving(provider);
    try {
      await aiApi.setEngineKey(provider, apiKey);
      toast({ type: 'success', message: `API key de ${PROVIDER_LABELS[provider] || provider} guardada` });
      setValues((v) => ({ ...v, [provider]: '' }));
      await onSaved();
    } catch {
      toast({ type: 'error', message: 'No se pudo guardar la API key' });
    }
    setSaving(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand-400" /> API Keys
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Cargá tu propia API key por proveedor. Se guarda cifrada y nunca se muestra de vuelta.
          Dejá el campo vacío y guardá para borrarla.
        </p>

        <div className="space-y-3">
          {providers.map(({ provider, hasKey }) => (
            <div key={provider}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-300 font-medium">{PROVIDER_LABELS[provider] || provider}</label>
                {hasKey && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                    <Check className="h-3 w-3" /> configurada
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={values[provider] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [provider]: e.target.value }))}
                  placeholder={hasKey ? '•••••••• (cargada — escribí para reemplazar)' : 'Pegá tu API key'}
                  className="input flex-1 font-mono text-xs"
                />
                <button
                  onClick={() => save(provider)}
                  disabled={saving === provider || !(values[provider] || '').trim()}
                  className="btn-primary text-xs px-3"
                >
                  {saving === provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
