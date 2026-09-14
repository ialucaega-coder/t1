'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Clock, Zap, Trophy, Github, ThumbsUp, Upload, Code2, Lightbulb } from 'lucide-react';
import { useArena } from '@/hooks/use-arena';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import type { ArenaBuilder, ArenaIdea } from '@/types/arena';

type Tab = 'chat' | 'builders' | 'ideas';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: string;
  responseTime?: number;
}

const testScenarios = [
  { id: 'reserva', label: 'Reservar una cita', message: 'Hola, quiero reservar un corte de pelo para mañana a las 3pm' },
  { id: 'precio', label: 'Consultar precios', message: '¿Cuánto cuesta un corte con barba?' },
  { id: 'horarios', label: 'Ver horarios', message: '¿Qué horarios tienen disponibles esta semana?' },
  { id: 'cancelar', label: 'Cancelar cita', message: 'Necesito cancelar mi cita de mañana' },
  { id: 'ubicacion', label: 'Ubicación', message: '¿Dónde están ubicados? ¿Cómo llego?' },
  { id: 'productos', label: 'Consultar productos', message: '¿Qué productos de cuidado capilar venden?' },
];

const prizes = [
  { place: '1er lugar', icon: '1F947', reward: '1 año de Local B+ gratis + 30 min 1-a-1 + grupo privado de WhatsApp' },
  { place: '2do lugar', icon: '1F948', reward: '$200 USD + 30 min 1-a-1 + grupo privado de WhatsApp' },
  { place: '3er lugar', icon: '1F949', reward: '30 min 1-a-1 + acceso al grupo privado de WhatsApp' },
];

export default function ArenaPage() {
  const { builders, ideas, isLoading, error, refetch, voteIdea, sendChat } = useArena();
  const [tab, setTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'bot', text: '¡Hola! Soy el bot de prueba de tu negocio. Escríbeme algo o selecciona un escenario para probar mis respuestas.', timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [lastResponseTime, setLastResponseTime] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: text.trim(), timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    const start = Date.now();
    try {
      const res = await sendChat(text.trim());
      const elapsed = Date.now() - start;
      const botMsg: Message = { id: (Date.now() + 1).toString(), role: 'bot', text: res?.reply || 'Entendido. Déjame consultar eso y te respondo en un momento.', timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), responseTime: elapsed };
      setMessages((prev) => [...prev, botMsg]);
      setLastResponseTime(elapsed);
    } catch {
      const elapsed = Date.now() - start;
      const botMsg: Message = { id: (Date.now() + 1).toString(), role: 'bot', text: 'Entendido. Déjame consultar eso y te respondo en un momento. ¿Hay algo más en lo que pueda ayudarte?', timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), responseTime: elapsed };
      setMessages((prev) => [...prev, botMsg]);
      setLastResponseTime(elapsed);
    } finally { setIsTyping(false); }
  };

  const podio = builders.filter((b: ArenaBuilder) => b.rank <= 3).sort((a: ArenaBuilder, b: ArenaBuilder) => a.rank - b.rank);
  const ranking = builders.filter((b: ArenaBuilder) => b.rank > 3).sort((a: ArenaBuilder, b: ArenaBuilder) => a.rank - b.rank);

  return (
    <div className="space-y-6">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <div className="flex rounded-lg border border-slate-700 overflow-hidden w-fit">
        {([{ id: 'chat' as Tab, label: 'Probar Bot', icon: Bot }, { id: 'builders' as Tab, label: 'Builders', icon: Code2 }, { id: 'ideas' as Tab, label: 'Ideas', icon: Lightbulb }]).map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? 'bg-brand-400 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-3">
            <p className="mono-label">ESCENARIOS DE PRUEBA</p>
            <div className="space-y-2">
              {testScenarios.map((s) => (
                <button key={s.id} onClick={() => sendMessage(s.message)} className="w-full text-left card hover:border-brand-500/50 transition-colors p-3">
                  <p className="text-sm font-medium text-white">{s.label}</p>
                  <p className="text-[10px] text-slate-500 mt-1 truncate">{s.message}</p>
                </button>
              ))}
            </div>
            {lastResponseTime !== null && (
              <div className="card-accent">
                <div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-brand-400" /><p className="text-xs font-medium text-white">Tiempo de respuesta</p></div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden"><div className="h-full rounded-full bg-brand-400 transition-all duration-500" style={{ width: `${Math.min((lastResponseTime / 1500) * 100, 100)}%` }} /></div>
                  <span className="text-xs font-mono text-brand-400">{lastResponseTime}ms</span>
                </div>
                <div className="flex items-center gap-1 mt-2"><Zap className="h-3 w-3 text-emerald-400" /><span className="text-[10px] text-emerald-400">{lastResponseTime < 600 ? 'Excelente' : lastResponseTime < 1000 ? 'Bueno' : 'Aceptable'}</span></div>
              </div>
            )}
          </div>

          <div className="lg:col-span-3 card p-0 flex flex-col" style={{ height: '520px' }}>
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-brand-400/20 flex items-center justify-center"><Bot className="h-4 w-4 text-brand-400" /></div>
              <div>
                <p className="text-sm font-medium text-white">Bot de prueba</p>
                <p className="text-[10px] text-emerald-400 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />En línea</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'bot' && <div className="h-7 w-7 rounded-full bg-brand-400/20 flex items-center justify-center shrink-0 mt-1"><Bot className="h-3.5 w-3.5 text-brand-400" /></div>}
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${msg.role === 'user' ? 'bg-brand-400 text-white rounded-br-md' : 'bg-surface-100 text-slate-200 border border-slate-700/50 rounded-bl-md'}`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <div className={`flex items-center gap-2 mt-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      <span className={`text-[10px] ${msg.role === 'user' ? 'text-brand-200' : 'text-slate-500'}`}>{msg.timestamp}</span>
                      {msg.responseTime && <span className="text-[10px] text-slate-500 flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{msg.responseTime}ms</span>}
                    </div>
                  </div>
                  {msg.role === 'user' && <div className="h-7 w-7 rounded-full bg-slate-600 flex items-center justify-center shrink-0 mt-1"><User className="h-3.5 w-3.5 text-slate-300" /></div>}
                </div>
              ))}
              {isTyping && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-brand-400/20 flex items-center justify-center shrink-0 mt-1"><Bot className="h-3.5 w-3.5 text-brand-400" /></div>
                  <div className="bg-surface-100 border border-slate-700/50 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="px-4 py-3 border-t border-slate-700/50">
              <div className="flex items-center gap-2">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)} placeholder="Escribe un mensaje para probar..." className="input flex-1" disabled={isTyping} />
                <button onClick={() => sendMessage(input)} disabled={!input.trim() || isTyping} className="btn-primary p-2.5 disabled:opacity-50"><Send className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'builders' && (
        <>
          {isLoading ? <LoadingSpinner label="Cargando builders..." /> : (
            <>
              <div className="card-accent">
                <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-400" /> Premios de la temporada</h3>
                <p className="text-sm text-slate-400 mb-4">Suben código real a GitHub. Los más votados ganan — y su feature entra al core.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {prizes.map((prize) => (
                    <div key={prize.place} className="card flex items-start gap-3">
                      <span className="text-2xl">{String.fromCodePoint(parseInt(prize.icon, 16))}</span>
                      <div><p className="text-sm font-semibold text-white">{prize.place}</p><p className="text-xs text-slate-400">{prize.reward}</p></div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="mono-label">PODIO</p>
                  <button className="btn-primary text-xs"><Upload className="h-3.5 w-3.5" /> Subir contribución</button>
                </div>
                {podio.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {podio.map((entry: ArenaBuilder) => (
                      <div key={entry.id} className="card-accent">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xl">{entry.rank === 1 ? String.fromCodePoint(0x1F947) : entry.rank === 2 ? String.fromCodePoint(0x1F948) : String.fromCodePoint(0x1F949)}</span>
                        </div>
                        <h4 className="font-semibold text-white text-sm mb-2">{entry.title}</h4>
                        <p className="text-xs text-slate-400 mb-3">{entry.description || ''}</p>
                        {entry.github && <a href="#" className="mono-label hover:text-brand-300 flex items-center gap-1 mb-3"><Github className="h-3 w-3" /> GitHub</a>}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-brand-400/20 flex items-center justify-center text-[10px] font-bold text-brand-400">
                              {(entry.name || 'U').split(' ').map((n: string) => n[0]).join('')}
                            </div>
                            <p className="text-xs text-white">{entry.name || 'Anónimo'}</p>
                          </div>
                          <button className="flex items-center gap-1 text-slate-400 hover:text-brand-400"><ThumbsUp className="h-3.5 w-3.5" /><span className="text-sm font-bold">{entry.votes}</span></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 text-center py-8">Aún no hay contribuciones</p>
                )}
              </div>

              {ranking.length > 0 && (
                <div>
                  <p className="mono-label mb-3">RANKING</p>
                  <div className="space-y-2">
                    {ranking.map((entry: ArenaBuilder) => (
                      <div key={entry.id} className="card flex items-center gap-4">
                        <span className="text-lg font-bold text-slate-500 w-8">{entry.rank}</span>
                        <div className="h-7 w-7 rounded-full bg-brand-400/20 flex items-center justify-center text-[10px] font-bold text-brand-400">
                          {(entry.name || 'U').split(' ').map((n: string) => n[0]).join('')}
                        </div>
                        <div className="flex-1"><p className="text-sm font-medium text-white">{entry.title}</p><p className="text-xs text-slate-500">por {entry.name || 'Anónimo'}</p></div>
                        <button className="flex items-center gap-1 text-slate-400 hover:text-brand-400"><ThumbsUp className="h-3.5 w-3.5" /><span className="text-sm">{entry.votes}</span></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'ideas' && (
        <>
          {isLoading ? <LoadingSpinner label="Cargando ideas..." /> : ideas.length === 0 ? (
            <div className="text-center py-12">
              <Lightbulb className="h-8 w-8 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Las ideas de la comunidad aparecerán aquí.</p>
              <button className="btn-primary text-xs mt-4"><Lightbulb className="h-3.5 w-3.5" /> Proponer idea</button>
            </div>
          ) : (
            <div className="space-y-3">
              {ideas.map((idea: ArenaIdea) => (
                <div key={idea.id} className="card flex items-center gap-4">
                  <button onClick={() => voteIdea(idea.id)} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-brand-400">
                    <ThumbsUp className="h-4 w-4" /><span className="text-xs font-bold">{idea.votes || 0}</span>
                  </button>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{idea.title}</p>
                    <p className="text-xs text-slate-500">{idea.description}</p>
                  </div>
                  {idea.category && <span className="badge border text-[9px] bg-brand-400/10 text-brand-400 border-brand-400/20">{idea.category}</span>}
                </div>
              ))}
              <button className="btn-primary text-xs"><Lightbulb className="h-3.5 w-3.5" /> Proponer idea</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
