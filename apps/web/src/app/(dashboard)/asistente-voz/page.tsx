'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Phone, PhoneCall, PhoneOff, Mic, Bot, User, Wrench, CheckCircle2,
  Play, Settings2, Globe, Volume2, VolumeX, AlertTriangle, Sparkles, Copy, Check,
  Save, Loader2, Wand2,
} from 'lucide-react';
import * as voiceApi from '@/lib/api/voice';
import type { VoiceConfig } from '@/lib/api/voice';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/common/Toast';

// ────────────────────────────────────────────────────────────────
// Voces de Amazon Polly soportadas por Twilio (llamada real), por idioma.
// ────────────────────────────────────────────────────────────────
const POLLY_VOICES: Record<string, { id: string; label: string }[]> = {
  'es-MX': [
    { id: 'Polly.Mia', label: 'Mía — femenina (México)' },
    { id: 'Polly.Andres-Neural', label: 'Andrés — masculina, neural (México)' },
  ],
  'es-US': [
    { id: 'Polly.Lupe-Neural', label: 'Lupe — femenina, neural (US español)' },
    { id: 'Polly.Pedro-Neural', label: 'Pedro — masculina, neural (US español)' },
  ],
  'es-AR': [
    { id: 'Polly.Mia', label: 'Mía — femenina' },
    { id: 'Polly.Andres-Neural', label: 'Andrés — masculina, neural' },
  ],
  'es-ES': [
    { id: 'Polly.Lucia-Neural', label: 'Lucía — femenina, neural (España)' },
    { id: 'Polly.Sergio-Neural', label: 'Sergio — masculina, neural (España)' },
    { id: 'Polly.Conchita', label: 'Conchita — femenina (España)' },
  ],
  'en-US': [
    { id: 'Polly.Joanna-Neural', label: 'Joanna — female, neural (US English)' },
    { id: 'Polly.Matthew-Neural', label: 'Matthew — male, neural (US English)' },
  ],
};

const LANGUAGES = [
  { id: 'es-MX', label: 'Español (México)' },
  { id: 'es-AR', label: 'Español (Argentina)' },
  { id: 'es-US', label: 'Español (EE.UU.)' },
  { id: 'es-ES', label: 'Español (España)' },
  { id: 'en-US', label: 'Inglés (EE.UU.)' },
];

// Plantillas rápidas de personalidad.
const PERSONA_PRESETS: { name: string; text: string }[] = [
  { name: 'Cálido y cercano', text: 'Hablás de forma cálida, cercana y natural, tuteás al cliente y usás un tono amable. Respuestas breves, como una charla real por teléfono.' },
  { name: 'Formal y profesional', text: 'Mantenés un tono formal y profesional, tratás de usted al cliente, sos claro y conciso. Transmitís seriedad y confianza.' },
  { name: 'Divertido y relajado', text: 'Sos simpático y relajado, con un toque de humor amable. Hacés que el cliente se sienta cómodo sin perder la utilidad.' },
];

const STEPS = [
  { icon: PhoneCall, title: 'Entra la llamada', desc: 'Twilio recibe la llamada al número del negocio y avisa al servidor.', tech: 'POST /api/voice/incoming' },
  { icon: Mic, title: 'Escucha al cliente', desc: 'El cliente habla y Twilio transcribe la voz a texto en tiempo real.', tech: '<Gather input="speech">' },
  { icon: Bot, title: 'Piensa con IA', desc: 'El texto pasa al mismo cerebro que WhatsApp/Web: entiende la intención y consulta la base de datos.', tech: 'processMessage(VOICE)' },
  { icon: Wrench, title: 'Ejecuta acciones', desc: 'Busca disponibilidad, crea el turno o deriva a un humano según lo que pida el cliente.', tech: 'disponibilidad · reservas' },
  { icon: Volume2, title: 'Responde con voz', desc: 'La respuesta se convierte a voz natural (Amazon Polly) y se reproduce en la llamada.', tech: '<Say voice="Polly">' },
];

type Turn =
  | { who: 'ai' | 'client'; text: string; delay: number }
  | { who: 'tool'; text: string; result: string; delay: number };

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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-300 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg bg-slate-900/60 border border-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 outline-none px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500';

export default function AsistenteVozPage() {
  const { business } = useAuth();
  const { toast } = useToast();
  const businessName = business?.name || 'nuestro negocio';

  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [twilioReady, setTwilioReady] = useState(false);

  // Demo
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [demoVoiceUri, setDemoVoiceUri] = useState('');

  const mutedRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Carga inicial ───────────────────────────────────────────────
  useEffect(() => {
    setWebhookUrl(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/voice/incoming`);

    voiceApi.getConfig().then(setCfg).catch(() => setCfg(null)).finally(() => setLoading(false));
    voiceApi.getStatus().then((s) => setTwilioReady(s.configured)).catch(() => {});

    const loadVoices = () => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      setBrowserVoices(window.speechSynthesis.getVoices());
    };
    loadVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      timers.current.forEach(clearTimeout);
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript]);

  // Cuando cambia el idioma, si no hay voz de demo elegida, sugerir una acorde.
  useEffect(() => {
    if (!cfg || demoVoiceUri) return;
    const match = browserVoices.find((v) => v.lang?.toLowerCase().startsWith(cfg.language.slice(0, 2)));
    if (match) setDemoVoiceUri(match.voiceURI);
  }, [cfg, browserVoices, demoVoiceUri]);

  const set = <K extends keyof VoiceConfig>(key: K, val: VoiceConfig[K]) =>
    setCfg((c) => (c ? { ...c, [key]: val } : c));

  const pollyOptions = cfg ? (POLLY_VOICES[cfg.language] || POLLY_VOICES['es-MX']) : [];
  const demoVoices = cfg
    ? browserVoices.filter((v) => v.lang?.toLowerCase().startsWith(cfg.language.slice(0, 2)))
    : [];

  // ─── TTS del navegador (para escuchar en el panel) ───────────────
  const speak = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || mutedRef.current || !cfg) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = browserVoices.find((bv) => bv.voiceURI === demoVoiceUri);
    if (v) u.voice = v;
    u.lang = cfg.language;
    u.rate = cfg.rate;
    window.speechSynthesis.speak(u);
  };

  const previewVoice = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    speak(interpolate(cfg?.greeting || 'Hola, ¿en qué puedo ayudarte?'));
  };

  const interpolate = (t: string) =>
    (t || '').replace(/\{negocio\}/gi, businessName).replace(/\{asistente\}/gi, cfg?.assistantName || 'Asistente');

  // ─── Simulación de llamada ───────────────────────────────────────
  const buildScript = (): Turn[] => [
    { who: 'ai', text: interpolate(cfg!.greeting), delay: 900 },
    { who: 'client', text: 'Hola, quería sacar un turno para un corte de pelo mañana a la tarde.', delay: 2200 },
    { who: 'tool', text: 'buscar_disponibilidad(servicio: "Corte", fecha: "mañana", franja: "tarde")', result: '3 horarios libres: 15:00, 16:30, 18:00', delay: 1600 },
    { who: 'ai', text: 'Perfecto. Para mañana a la tarde tengo 15:00, 16:30 o 18:00. ¿Cuál te queda mejor?', delay: 1800 },
    { who: 'client', text: 'A las 16:30 está bien.', delay: 1600 },
    { who: 'tool', text: 'crear_turno(servicio: "Corte", fecha: "mañana", hora: "16:30")', result: 'Turno #1042 confirmado', delay: 1700 },
    { who: 'ai', text: 'Listo, te agendé el corte para mañana a las 16:30. Te llega la confirmación. ¿Necesitás algo más?', delay: 1900 },
    { who: 'client', text: 'No, muchas gracias.', delay: 1400 },
    { who: 'ai', text: interpolate(cfg!.closing), delay: 1200 },
  ];

  const runSimulation = () => {
    if (!cfg) return;
    timers.current.forEach(clearTimeout);
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setTranscript([]);
    setRunning(true);
    let acc = 400;
    buildScript().forEach((turn) => {
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

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const saved = await voiceApi.saveConfig(cfg);
      setCfg(saved);
      toast({ type: 'success', message: 'Configuración del asistente guardada' });
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'No se pudo guardar' });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !cfg) {
    return (
      <div className="p-6 flex items-center gap-2 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando asistente de voz…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <style>{`@keyframes voicePulse{from{transform:scaleY(.5)}to{transform:scaleY(1)}}`}</style>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center">
            <Phone className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              Asistente de Voz
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30">Nuevo</span>
            </h1>
            <p className="text-sm text-slate-400">Atiende llamadas telefónicas con IA, personalizado para {businessName}.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <span>{cfg.enabled ? 'Activo' : 'Inactivo'}</span>
            <button
              type="button"
              onClick={() => set('enabled', !cfg.enabled)}
              className={`relative w-11 h-6 rounded-full transition ${cfg.enabled ? 'bg-brand-500' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition ${cfg.enabled ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>
      </div>

      {!twilioReady && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          El asistente responde en esta demo, pero para recibir llamadas reales falta cargar las credenciales de Twilio.
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Demo */}
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-200 font-medium">
                <PhoneCall className={`w-4 h-4 ${running ? 'text-emerald-400' : 'text-slate-400'}`} />
                Llamada en vivo (demo)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  title={muted ? 'Activar voz' : 'Silenciar voz'}
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

            <div className="px-5 py-4 flex items-center gap-4 border-b border-slate-700/60 bg-slate-900/30">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${running ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-400'}`}>
                {running ? <PhoneCall className="w-5 h-5" /> : <PhoneOff className="w-5 h-5" />}
              </div>
              <div className="flex-1"><Waveform active={speaking} /></div>
              <div className="text-xs text-slate-400 min-w-[70px] text-right">
                {running ? (speaking ? 'Hablando…' : 'Escuchando…') : 'En espera'}
              </div>
            </div>

            <div ref={scrollRef} className="p-5 space-y-3 h-[340px] overflow-y-auto">
              {transcript.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
                  <Sparkles className="w-8 h-8 text-slate-600" />
                  <p className="text-sm">Tocá <span className="text-brand-400 font-medium">Simular llamada</span> para escuchar cómo suena tu asistente con la configuración actual.</p>
                </div>
              )}
              {transcript.map((t, i) => {
                if (t.who === 'tool') {
                  return (
                    <div key={i} className="mx-auto max-w-[90%] rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 text-brand-300 font-mono"><Wrench className="w-3.5 h-3.5" /> {t.text}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" /> {t.result}</div>
                    </div>
                  );
                }
                const isAi = t.who === 'ai';
                return (
                  <div key={i} className={`flex gap-2.5 ${isAi ? '' : 'flex-row-reverse'}`}>
                    <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${isAi ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-600/40 text-slate-300'}`}>
                      {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    </div>
                    <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${isAi ? 'bg-slate-700/50 text-slate-100 rounded-tl-sm' : 'bg-brand-500/90 text-white rounded-tr-sm'}`}>{t.text}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cómo funciona */}
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
            <div className="flex items-center gap-2 text-slate-200 font-medium mb-4"><Sparkles className="w-4 h-4 text-brand-400" /> Cómo funciona</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {STEPS.map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-4">
                  <div className="w-9 h-9 rounded-lg bg-brand-500/15 border border-brand-500/25 flex items-center justify-center mb-3"><s.icon className="w-4 h-4 text-brand-400" /></div>
                  <div className="text-xs font-semibold text-brand-400 mb-1">Paso {i + 1}</div>
                  <div className="text-sm font-medium text-slate-100 mb-1">{s.title}</div>
                  <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Configuración */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5 space-y-4">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <Settings2 className="w-4 h-4 text-brand-400" /> Personalización
            </div>

            <Field label="Nombre del asistente">
              <input className={inputCls} value={cfg.assistantName} onChange={(e) => set('assistantName', e.target.value)} placeholder="Sofía" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Idioma">
                <select className={inputCls} value={cfg.language} onChange={(e) => { set('language', e.target.value); const opts = POLLY_VOICES[e.target.value] || []; if (opts[0]) set('voice', opts[0].id); }}>
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </Field>
              <Field label="Voz (llamada real)">
                <select className={inputCls} value={cfg.voice} onChange={(e) => set('voice', e.target.value)}>
                  {pollyOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Field>
            </div>

            <div className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 text-brand-400" /> Previsualizar en el panel</span>
                <button onClick={previewVoice} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-brand-500/15 border border-brand-500/30 text-brand-300 hover:bg-brand-500/25">
                  <Play className="w-3 h-3" /> Probar voz
                </button>
              </div>
              <Field label="Voz de la demo (navegador)" hint="Solo para escuchar acá. La llamada real usa la voz de Amazon Polly de arriba.">
                <select className={inputCls} value={demoVoiceUri} onChange={(e) => setDemoVoiceUri(e.target.value)}>
                  {demoVoices.length === 0 && <option value="">(sin voces del navegador)</option>}
                  {demoVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
                </select>
              </Field>
              <Field label={`Velocidad: ${cfg.rate.toFixed(2)}×`}>
                <input type="range" min={0.6} max={1.4} step={0.05} value={cfg.rate} onChange={(e) => set('rate', parseFloat(e.target.value))} className="w-full accent-brand-500" />
              </Field>
            </div>

            <Field label="Saludo inicial" hint="Usá {negocio} y {asistente} para insertarlos automáticamente.">
              <textarea rows={3} className={inputCls} value={cfg.greeting} onChange={(e) => set('greeting', e.target.value)} />
            </Field>

            <Field label="Mensaje de despedida">
              <textarea rows={2} className={inputCls} value={cfg.closing} onChange={(e) => set('closing', e.target.value)} />
            </Field>

            <Field label="Si no entiende / no responde">
              <textarea rows={2} className={inputCls} value={cfg.reprompt} onChange={(e) => set('reprompt', e.target.value)} />
            </Field>

            <Field label="Personalidad y tono" hint="Instrucciones que definen cómo se comporta el asistente.">
              <textarea rows={4} className={inputCls} value={cfg.persona} onChange={(e) => set('persona', e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {PERSONA_PRESETS.map((p) => (
                <button key={p.name} onClick={() => set('persona', p.text)} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:border-brand-500/50 hover:text-brand-300 transition">
                  <Wand2 className="w-3 h-3" /> {p.name}
                </button>
              ))}
            </div>

            <button onClick={save} disabled={saving} className="w-full inline-flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>

          {/* Activar en número */}
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
            <div className="flex items-center gap-2 text-slate-200 font-medium mb-3"><PhoneCall className="w-4 h-4 text-brand-400" /> Activar en tu número</div>
            <ol className="text-sm text-slate-400 space-y-1.5 list-decimal list-inside">
              <li>Cargá <code className="text-brand-300 bg-slate-900/60 px-1 rounded">TWILIO_ACCOUNT_SID</code> y <code className="text-brand-300 bg-slate-900/60 px-1 rounded">TWILIO_AUTH_TOKEN</code>.</li>
              <li>Apuntá el webhook de voz (A Call Comes In) de tu número a:</li>
            </ol>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <code className="flex-1 text-xs text-slate-300 break-all">POST {webhookUrl || '…/voice/incoming'}</code>
              <button onClick={copyUrl} className="text-slate-400 hover:text-white transition shrink-0">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
