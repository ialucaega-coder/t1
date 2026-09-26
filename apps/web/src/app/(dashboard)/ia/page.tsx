'use client';

import { useState } from 'react';
import { Sparkles, Send, Loader2, Copy, Check } from 'lucide-react';
import * as aiApi from '@/lib/api/ai';
import type { ChatTurn } from '@/types';
import { MotorDeIA } from './MotorDeIA';

export default function IAPage() {
  return (
    <div className="space-y-6">
      <div className="card-accent">
        <p className="mono-label mb-1">CONFIGURACIÓN DE IA</p>
        <h3 className="text-lg font-bold text-white mb-2">El cerebro de tu bot</h3>
        <p className="text-sm text-slate-400">
          Elegí el motor de IA que responde a tus clientes, cargá tus API keys, editás el prompt de
          sistema que define cómo se comporta tu bot, y probalo con un mensaje real antes de publicarlo.
        </p>
      </div>

      <MotorDeIA />
      <PromptEditorSection />
      <TestChatSection />
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
