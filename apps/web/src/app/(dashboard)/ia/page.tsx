'use client';

import { useEffect, useState } from 'react';
import { Bot, Sparkles, Send, Loader2, CheckCircle2, XCircle, Copy, Check } from 'lucide-react';
import * as aiApi from '@/lib/api/ai';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import type { AIProviderStatus, AIProvidersResponse, ChatTurn } from '@/types';

// Metadata solo visual (nombre lindo, descripción, colores) para cada proveedor
// soportado por el backend. El estado real (configurado o no) viene de la API.
const PROVIDER_META: Record<string, { label: string; description: string; color: string }> = {
  anthropic: {
    label: 'Claude (Anthropic)',
    description: 'El modelo detrás de este mismo panel — gran balance de calidad y costo.',
    color: 'from-amber-500/10 to-amber-600/5',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    description: 'La IA más conocida — modelos rápidos y económicos para volumen alto.',
    color: 'from-green-500/10 to-green-600/5',
  },
};

export default function IAPage() {
  return (
    <div className="space-y-6">
      <div className="card-accent">
        <p className="mono-label mb-1">CONFIGURACIÓN DE IA</p>
        <h3 className="text-lg font-bold text-white mb-2">El cerebro de tu bot</h3>
        <p className="text-sm text-slate-400">
          Acá ves qué proveedores de IA están conectados, editás el prompt de sistema que define
          cómo se comporta tu bot, y podés probarlo con un mensaje real antes de publicarlo.
        </p>
      </div>

      <ProvidersSection />
      <PromptEditorSection />
      <TestChatSection />
    </div>
  );
}

/** Sección: estado de los proveedores de IA configurados en el backend. */
function ProvidersSection() {
  const [providers, setProviders] = useState<AIProviderStatus[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Carga el estado de los proveedores al montar el componente.
    aiApi
      .getProviders()
      .then((res: AIProvidersResponse) => {
        if (cancelled) return;
        setProviders(res.providers);
        setDefaultProvider(res.defaultProvider);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar el estado de los proveedores');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <p className="mono-label mb-2">PROVEEDORES</p>
      <h3 className="text-lg font-bold text-white mb-4">Estado de conexión</h3>

      {loading && <LoadingSpinner label="Cargando IA..." />}

      {error && <ErrorAlert message={error} />}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((provider) => {
            const meta = PROVIDER_META[provider.name] ?? {
              label: provider.name,
              description: '',
              color: 'from-slate-500/10 to-slate-600/5',
            };
            const isDefault = defaultProvider === provider.name;
            return (
              <div key={provider.name} className={`card-accent bg-gradient-to-br ${meta.color}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface">
                    <Bot className="h-5 w-5 text-brand-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-white">{meta.label}</h4>
                    <p className="text-xs text-slate-400">{meta.description}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {provider.configured ? (
                    <span className="badge-active flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> CONECTADO
                    </span>
                  ) : (
                    <span className="badge text-slate-500 border border-slate-700 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> SIN CONFIGURAR
                    </span>
                  )}
                  {isDefault && <span className="badge-premium">POR DEFECTO</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Sección: editor del prompt de sistema, con generación automática desde los datos del negocio. */
function PromptEditorSection() {
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState<'formal' | 'amigable' | 'directo'>('amigable');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await aiApi.generatePrompt(tone);
      setPrompt(res.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el prompt');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!prompt) return;
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="mono-label mb-1">PROMPT DE SISTEMA</p>
          <h3 className="text-lg font-bold text-white">Editor y vista previa</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-auto text-xs py-1.5"
            value={tone}
            onChange={(e) => setTone(e.target.value as typeof tone)}
          >
            <option value="amigable">Tono amigable</option>
            <option value="formal">Tono formal</option>
            <option value="directo">Tono directo</option>
          </select>
          <button className="btn-primary text-xs py-1.5" onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generar desde mi negocio
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      <div className="card grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col">
          <p className="section-label">EDITAR</p>
          <textarea
            className="input flex-1 min-h-[220px] font-mono text-xs resize-none"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Hacé clic en 'Generar desde mi negocio' o escribí tu propio prompt de sistema acá..."
          />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <p className="section-label mb-0">VISTA PREVIA</p>
            <button className="btn-secondary text-xs py-1 px-2" onClick={handleCopy} disabled={!prompt}>
              {copied ? (
                <><Check className="h-3 w-3 text-emerald-400" /> Copiado</>
              ) : (
                <><Copy className="h-3 w-3" /> Copiar</>
              )}
            </button>
          </div>
          <pre className="flex-1 min-h-[220px] text-xs text-slate-300 bg-surface rounded-lg p-3 whitespace-pre-wrap font-mono overflow-auto">
            {prompt || 'Acá vas a ver el prompt tal como se lo va a mandar al modelo de IA.'}
          </pre>
        </div>
      </div>
    </div>
  );
}

/** Sección: chat de prueba simple para validar el comportamiento del bot en vivo. */
function TestChatSection() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const nextHistory = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await aiApi.sendChatMessage(text, messages);
      setMessages([...nextHistory, { role: 'assistant', content: res.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <p className="mono-label mb-2">PROBAR EL BOT</p>
      <h3 className="text-lg font-bold text-white mb-4">Chat de prueba</h3>

      <div className="card flex flex-col h-96">
        <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-slate-500">
              Escribí un mensaje como lo haría un cliente (ej: &quot;¿tenés turno mañana?&quot;) para probar el bot.
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-brand-500 text-white'
                    : 'bg-surface text-slate-200 border border-slate-700'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-surface text-slate-400 border border-slate-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando...
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder="Escribí un mensaje de prueba..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
          />
          <button className="btn-primary text-xs py-2.5 px-3" onClick={handleSend} disabled={sending || !input.trim()}>
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
