'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Phone, PhoneCall, PhoneOff, Mic, Bot, User, Wrench, CheckCircle2,
  Play, Settings2, Globe, Volume2, VolumeX, AlertTriangle, Sparkles, Copy, Check,
} from 'lucide-react';
import * as voiceApi from '@/lib/api/voice';
import type { VoiceStatus } from '@/lib/api/voice';

// ────────────────────────────────────────────────────────────────
// Guion de la simulación de llamada (cliente ↔ asistente).
// Es una demo client-side para ver el flujo sin necesidad de Twilio;
// el backend real vive en POST /api/voice/incoming y /respond.
// ────────────────────────────────────────────────────────────────
type Turn =
  | { who: 'ai' | 'client'; text: string; delay: number }
  | { who: 'tool'; text: string; result: string; delay: number };

const SCRIPT: Turn[] = [
  { who: 'ai', text: 'Hola, gracias por comunicarte con Mi Negocio. Soy el asistente virtual. ¿En qué puedo ayudarte?', delay: 900 },
  { who: 'client', text: 'Hola, quería sacar un turno para un corte de pelo mañana a la tarde.', delay: 2200 },
  { who: 'tool', text: 'buscar_disponibilidad(servicio: "Corte", fecha: "mañana", franja: "tarde")', result: '3 horarios libres: 15:00, 16:30, 18:00', delay: 1600 },
  { who: 'ai', text: 'Perfecto. Para mañana a la tarde tengo disponible a las 15:00, 16:30 o 18:00. ¿Cuál te queda mejor?', delay: 1800 },
  { who: 'client', text: 'A las 16:30 está bien.', delay: 1600 },
  { who: 'tool', text: 'crear_turno(servicio: "Corte", fecha: "mañana", hora: "16:30", cliente: "+54 9 11 5555-0000")', result: 'Turno #1042 confirmado', delay: 1700 },
  { who: 'ai', text: 'Listo, te agendé el corte para mañana a las 16:30. Te va a llegar la confirmación. ¿Necesitás algo más?', delay: 1900 },
  { who: 'client', text: 'No, muchas gracias.', delay: 1400 },
  { who: 'ai', text: 'Gracias por llamar. ¡Que tengas un buen día!', delay: 1200 },
];

const STEPS = [
  { icon: PhoneCall, title: 'Entra la llamada', desc: 'Twilio recibe la llamada al número del negocio y avisa al servidor.', tech: 'POST /api/voice/incoming' },
  { icon: Mic, title: 'Escucha al cliente', desc: 'El cliente habla y Twilio transcribe la voz a texto en tiempo real.', tech: '<Gather input="speech">' },
  { icon: Bot, title: 'Piensa con IA', desc: 'El texto pasa al mismo cerebro que WhatsApp/Web: entiende la intención y consulta la base de datos.', tech: 'processMessage(VOICE)' },
  { icon: Wrench, title: 'Ejecuta acciones', desc: 'Busca disponibilidad, crea el turno o deriva a un humano según lo que pida el cliente.', tech: 'disponibilidad · reservas' },
  { icon: Volume2, title: 'Responde con voz', desc: 'La respuesta se convierte a voz natural y se reproduce en la llamada.', tech: '<Say voice="Polly">' },
];

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1 h-8">
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-brand-400"
          style={{
            height: active ? `${20 + Math.abs(Math.sin(i * 1.3)) * 80}%` : '18%',
            animation: active ? `voicePulse 0.9s ease-in-out ${i * 0.05}s infinite alternate` : 'none',
            opacity: active ? 1 : 0.35,
            transition: 'height .2s, opacity .2s',
          }}
        />
      ))}
    </div>
  );
}

export default function AsistenteVozPage() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lang = status?.language || 'es-MX';

  // Elige la mejor voz en español disponible en el navegador. Las voces
  // cargan de forma asíncrona, así que escuchamos 'voiceschanged'.
  const pickVoice = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    const es = voices.filter((v) => v.lang?.toLowerCase().startsWith('es'));
    voiceRef.current =
      es.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
      es.find((v) => /google|microsoft/i.test(v.name)) ||
      es[0] ||
      null;
  };

  // Reproduce un texto con la voz del navegador (TTS). Es la misma idea que
  // hace Twilio en la llamada real con Amazon Polly, pero acá suena en local.
  const speak = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || mutedRef.current) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 1.02;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    // Se calcula tras montar para evitar mismatch de hidratación: el valor de
    // NEXT_PUBLIC_API_URL puede diferir entre el runtime del server y el bundle
    // del cliente. El primer render (SSR y cliente) muestra el placeholder.
    setWebhookUrl(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/voice/incoming`);
    voiceApi.getStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoadingStatus(false));

    pickVoice();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = pickVoice;
    }

    return () => {
      timers.current.forEach(clearTimeout);
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript]);

  const runSimulation = () => {
    timers.current.forEach(clearTimeout);
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    pickVoice();
    setTranscript([]);
    setRunning(true);
    let acc = 400;
    SCRIPT.forEach((turn) => {
      acc += turn.delay;
      const at = acc;
      timers.current.push(setTimeout(() => {
        setSpeaking(turn.who === 'ai');
        setTranscript((prev) => [...prev, turn]);
        if (turn.who === 'ai') speak(turn.text);
      }, at - turn.delay + 200));
    });
    timers.current.push(setTimeout(() => { setRunning(false); setSpeaking(false); }, acc + 400));
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (next && typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
      return next;
    });
  };

  const copyUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <style>{`@keyframes voicePulse{from{transform:scaleY(.5)}to{transform:scaleY(1)}}`}</style>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center">
              <Phone className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
                Asistente de Voz
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30">Nuevo</span>
              </h1>
              <p className="text-sm text-slate-400">Atiende llamadas telefónicas reales con IA: agenda turnos, responde consultas y deriva a un humano.</p>
            </div>
          </div>
        </div>
        {!loadingStatus && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${status?.configured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
            {status?.configured ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {status?.configured ? 'Twilio configurado' : 'Inactivo — falta configurar Twilio'}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Simulación de llamada */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-700/60 bg-slate-800/40 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <PhoneCall className={`w-4 h-4 ${running ? 'text-emerald-400' : 'text-slate-400'}`} />
              Llamada en vivo (demo)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                title={muted ? 'Activar voz' : 'Silenciar voz'}
                aria-label={muted ? 'Activar voz' : 'Silenciar voz'}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition ${muted ? 'border-slate-700 text-slate-500 hover:text-slate-300' : 'border-brand-500/40 text-brand-400 bg-brand-500/10'}`}
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                onClick={runSimulation}
                disabled={running}
                className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 disabled:cursor-not-allowed text-white transition"
              >
                <Play className="w-4 h-4" />
                {running ? 'Simulando…' : 'Simular llamada'}
              </button>
            </div>
          </div>

          {/* Estado / waveform */}
          <div className="px-5 py-4 flex items-center gap-4 border-b border-slate-700/60 bg-slate-900/30">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${running ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-400'}`}>
              {running ? <PhoneCall className="w-5 h-5" /> : <PhoneOff className="w-5 h-5" />}
            </div>
            <div className="flex-1">
              <Waveform active={speaking} />
            </div>
            <div className="text-xs text-slate-400 min-w-[70px] text-right">
              {running ? (speaking ? 'Hablando…' : 'Escuchando…') : 'En espera'}
            </div>
          </div>

          {/* Transcript */}
          <div ref={scrollRef} className="p-5 space-y-3 h-[360px] overflow-y-auto">
            {transcript.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
                <Sparkles className="w-8 h-8 text-slate-600" />
                <p className="text-sm">Tocá <span className="text-brand-400 font-medium">Simular llamada</span> para ver cómo el asistente agenda un turno por teléfono.</p>
              </div>
            )}
            {transcript.map((t, i) => {
              if (t.who === 'tool') {
                return (
                  <div key={i} className="mx-auto max-w-[90%] rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 text-brand-300 font-mono">
                      <Wrench className="w-3.5 h-3.5" /> {t.text}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {t.result}
                    </div>
                  </div>
                );
              }
              const isAi = t.who === 'ai';
              return (
                <div key={i} className={`flex gap-2.5 ${isAi ? '' : 'flex-row-reverse'}`}>
                  <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${isAi ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-600/40 text-slate-300'}`}>
                    {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  </div>
                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${isAi ? 'bg-slate-700/50 text-slate-100 rounded-tl-sm' : 'bg-brand-500/90 text-white rounded-tr-sm'}`}>
                    {t.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Config + setup */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
            <div className="flex items-center gap-2 text-slate-200 font-medium mb-4">
              <Settings2 className="w-4 h-4 text-brand-400" /> Configuración
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-slate-400"><Globe className="w-4 h-4" /> Idioma</dt>
                <dd className="text-slate-100 font-medium">{loadingStatus ? '…' : (status?.language ?? 'es-MX')}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-slate-400"><Volume2 className="w-4 h-4" /> Voz</dt>
                <dd className="text-slate-100 font-medium">{loadingStatus ? '…' : (status?.voice ?? 'Polly.Mia')}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-slate-400"><Bot className="w-4 h-4" /> Cerebro IA</dt>
                <dd className="text-slate-100 font-medium">Compartido</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
            <div className="flex items-center gap-2 text-slate-200 font-medium mb-3">
              <PhoneCall className="w-4 h-4 text-brand-400" /> Activar en tu número
            </div>
            <ol className="text-sm text-slate-400 space-y-2 list-decimal list-inside">
              <li>Cargá <code className="text-brand-300 bg-slate-900/60 px-1 rounded">TWILIO_ACCOUNT_SID</code> y <code className="text-brand-300 bg-slate-900/60 px-1 rounded">TWILIO_AUTH_TOKEN</code>.</li>
              <li>En tu número de Twilio, configurá el webhook de voz (A Call Comes In) a:</li>
            </ol>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <code className="flex-1 text-xs text-slate-300 break-all">POST {webhookUrl || '…/voice/incoming'}</code>
              <button onClick={copyUrl} className="text-slate-400 hover:text-white transition shrink-0">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {!loadingStatus && !status?.configured && (
              <p className="mt-3 text-xs text-amber-300/90 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {status?.hint ?? 'Faltan credenciales de Twilio para activar las llamadas.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Cómo funciona */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
        <div className="flex items-center gap-2 text-slate-200 font-medium mb-4">
          <Sparkles className="w-4 h-4 text-brand-400" /> Cómo funciona
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {STEPS.map((s, i) => (
            <div key={i} className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-4">
              <div className="w-9 h-9 rounded-lg bg-brand-500/15 border border-brand-500/25 flex items-center justify-center mb-3">
                <s.icon className="w-4 h-4 text-brand-400" />
              </div>
              <div className="text-xs font-semibold text-brand-400 mb-1">Paso {i + 1}</div>
              <div className="text-sm font-medium text-slate-100 mb-1">{s.title}</div>
              <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
              <code className="mt-2 block text-[10px] text-slate-500 font-mono break-all">{s.tech}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

