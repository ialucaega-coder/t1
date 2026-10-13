'use client';

/**
 * Mr Go — Centro de operaciones ("La oficina viva").
 *
 * El dueño ve a su equipo de agentes Mr Go trabajando (grilla de escritorios) y
 * le da órdenes al equipo. El orquestador (POST /mrgo/orchestrate) decide qué
 * agente la atiende, con qué emoción y qué acción (tool) proponer. Si está
 * activo "Ejecutar en vivo", el tool se EJECUTA de verdad (acciones externas
 * reales); si no, se simula. El resultado se muestra en el feed.
 *
 * Layout: split ~70/30 (en móvil apila). Izquierda = la oficina (agentes
 * activos, CEO destacado). Derecha = centro de comandos (input + feed).
 */

import { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, Building2, Radio, Wrench, Info, AlertTriangle, Brain, Plus, Trash2, Save } from 'lucide-react';
import { MrGoAvatar } from '@/components/mrgo/MrGoAvatar';
import type { MrGoEmotion } from '@/components/mrgo/types';
import {
  getMrGoAgents,
  orchestrate,
  getMrGoMemory,
  saveMrGoMemory,
  colorKeyForAgent,
  mapEmotion,
  CEO_AGENT_KEY,
  type MrGoAgentConfig,
  type MrGoRole,
  type MrGoTool,
  type OrchestratorDecision,
  type ActionResult,
} from '@/lib/api/mrgo';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';

/** Un agente listo para la UI: config del negocio + datos de presentación. */
interface DeskAgent {
  key: string;
  nombre: string;
  descripcion: string;
  activo: boolean;
}

/** Un evento del feed "Lo que está pasando". */
interface FeedEvent {
  id: string;
  agentKey: string;
  agentNombre: string;
  emotion: MrGoEmotion;
  reasoning: string;
  toolNombre?: string;
  execution?: ActionResult | null;
  esFallback: boolean;
  hora: string;
}

// Límites de la memoria de Mr Go (espejan los del backend).
const MEMORY_PROFILE_MAX = 2000;
const MEMORY_FACT_MAX = 300;
const MEMORY_FACTS_MAX = 50;

/** Detecta si la decisión degradó al routing por defecto (sin LLM / falló). */
function esDecisionFallback(d: OrchestratorDecision): boolean {
  return d.reasoning.trim().toLowerCase().startsWith('routing por defecto');
}

/** Clases + etiqueta del badge según el estado de ejecución de la acción. */
function statusBadge(status: ActionResult['status']): { label: string; cls: string } {
  switch (status) {
    case 'ejecutado':
      return { label: 'Ejecutado', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    case 'simulado':
      return { label: 'Simulado', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' };
    case 'omitido':
      return { label: 'Omitido', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    case 'no_soportado':
      return { label: 'No soportado', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
    case 'error':
      return { label: 'Error', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
    default:
      return { label: status, cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  }
}

export default function OficinaPage() {
  const { toast } = useToast();

  const [roles, setRoles] = useState<MrGoRole[]>([]);
  const [agents, setAgents] = useState<MrGoAgentConfig[]>([]);
  const [tools, setTools] = useState<MrGoTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orden, setOrden] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Ejecutar en vivo: si está activo, el tool que proponga Mr Go se EJECUTA de
  // verdad (acciones externas reales). Apagado por defecto (solo simula).
  const [ejecutarEnVivo, setEjecutarEnVivo] = useState(false);

  // Emoción actual por agente (clave → emoción). Los activos arrancan 'working';
  // cuando el orquestador deriva a uno, ese pasa a la emoción de la decisión.
  const [emociones, setEmociones] = useState<Record<string, MrGoEmotion>>({});
  // Agente resaltado tras la última orden (se le ilumina el escritorio).
  const [resaltado, setResaltado] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);

  // Memoria de Mr Go (profile + facts). Se carga aparte de los agentes.
  const [memProfile, setMemProfile] = useState('');
  const [memFacts, setMemFacts] = useState<string[]>([]);
  const [nuevoHecho, setNuevoHecho] = useState('');
  const [guardandoMem, setGuardandoMem] = useState(false);

  async function cargar() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getMrGoAgents();
      setAgents(data.agents);
      setRoles(data.roles);
      setTools(data.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el equipo de Mr Go.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  // Carga la memoria del negocio al montar (silenciosa: si falla, se deja vacía
  // y el dueño igual puede escribir y guardar).
  useEffect(() => {
    let activo = true;
    getMrGoMemory()
      .then((mem) => {
        if (!activo) return;
        setMemProfile(mem.profile ?? '');
        setMemFacts(Array.isArray(mem.facts) ? mem.facts : []);
      })
      .catch(() => {
        /* memoria opcional: no bloqueamos la oficina si no se pudo leer */
      });
    return () => {
      activo = false;
    };
  }, []);

  /** Suma un hecho nuevo a la lista (respetando los límites del backend). */
  function agregarHecho() {
    const h = nuevoHecho.trim();
    if (!h || memFacts.length >= MEMORY_FACTS_MAX) return;
    setMemFacts((prev) => [...prev, h.slice(0, MEMORY_FACT_MAX)]);
    setNuevoHecho('');
  }

  /** Borra el hecho en la posición indicada. */
  function borrarHecho(index: number) {
    setMemFacts((prev) => prev.filter((_, i) => i !== index));
  }

  async function guardarMemoria() {
    if (guardandoMem) return;
    setGuardandoMem(true);
    try {
      const saved = await saveMrGoMemory({ profile: memProfile, facts: memFacts });
      setMemProfile(saved.profile ?? '');
      setMemFacts(Array.isArray(saved.facts) ? saved.facts : []);
      toast({ type: 'success', message: 'Memoria de Mr Go guardada.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('403') || /forbidden/i.test(msg)) {
        toast({ type: 'error', message: 'Solo un admin puede editar la memoria.' });
      } else {
        toast({ type: 'error', message: msg || 'No se pudo guardar la memoria de Mr Go.' });
      }
    } finally {
      setGuardandoMem(false);
    }
  }

  // Índices por clave para unir config (activo) con presentación (nombre/desc).
  const roleByKey = useMemo(() => {
    const m = new Map<string, MrGoRole>();
    for (const r of roles) m.set(r.key, r);
    return m;
  }, [roles]);

  const toolByKey = useMemo(() => {
    const m = new Map<string, MrGoTool>();
    for (const t of tools) m.set(t.key, t);
    return m;
  }, [tools]);

  // Agentes activos listos para pintar, con CEO siempre primero.
  const { ceo, equipo } = useMemo(() => {
    const activos: DeskAgent[] = agents
      .filter((a) => a.activo)
      .map((a) => {
        const role = roleByKey.get(a.key);
        return {
          key: a.key,
          nombre: role?.nombre ?? a.key,
          descripcion: role?.descripcion ?? '',
          activo: a.activo,
        };
      });
    return {
      ceo: activos.find((a) => a.key === CEO_AGENT_KEY) ?? null,
      equipo: activos.filter((a) => a.key !== CEO_AGENT_KEY),
    };
  }, [agents, roleByKey]);

  /** Emoción a mostrar para un agente (override de la última orden o 'working'). */
  function emocionDe(key: string): MrGoEmotion {
    return emociones[key] ?? 'working';
  }

  async function enviarOrden() {
    const text = orden.trim();
    if (!text || enviando) return;
    setEnviando(true);
    try {
      const decision = await orchestrate(text, undefined, ejecutarEnVivo);
      const role = roleByKey.get(decision.nextAgent);
      const emotion = mapEmotion(decision.emotion);
      const esFallback = esDecisionFallback(decision);

      // Ilumina el escritorio del agente elegido y actualiza su emoción.
      setResaltado(decision.nextAgent);
      setEmociones((prev) => ({ ...prev, [decision.nextAgent]: emotion }));

      const evento: FeedEvent = {
        id: crypto.randomUUID(),
        agentKey: decision.nextAgent,
        agentNombre: role?.nombre ?? decision.nextAgent,
        emotion,
        reasoning: decision.reasoning || 'Sin explicación.',
        toolNombre: decision.tool ? toolByKey.get(decision.tool)?.nombre ?? decision.tool : undefined,
        execution: decision.execution,
        esFallback,
        hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      };
      setFeed((prev) => [evento, ...prev].slice(0, 30));
      setOrden('');

      toast({
        type: esFallback ? 'info' : 'success',
        message: esFallback
          ? `Sin IA configurada: la orden fue a ${evento.agentNombre} por defecto.`
          : `Mr Go derivó la orden a ${evento.agentNombre}.`,
      });
    } catch (err) {
      toast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo enviar la orden al equipo.',
      });
    } finally {
      setEnviando(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envía; Shift+Enter hace salto de línea.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarOrden();
    }
  }

  if (isLoading) {
    return <LoadingSpinner label="Abriendo la oficina de Mr Go..." />;
  }

  const sinActivos = !ceo && equipo.length === 0;

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Building2 className="h-6 w-6 text-brand-400" />
          Mr Go — Centro de operaciones
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Tu equipo de agentes trabaja acá. Dale una orden y Mr Go la reparte al agente indicado.
        </p>
      </div>

      {error && <ErrorAlert message={error} onRetry={cargar} />}

      {sinActivos && !error ? (
        <EmptyState
          icon={Building2}
          title="No hay agentes activos"
          description="Activá al menos un agente de Mr Go para empezar a darle órdenes al equipo."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
          {/* Izquierda — La oficina (~70%) */}
          <section className="lg:col-span-7">
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  La oficina
                </h2>
                <span className="text-xs text-slate-500">
                  {(ceo ? 1 : 0) + equipo.length} en funciones
                </span>
              </div>

              {/* CEO destacado */}
              {ceo && (
                <DeskCard
                  agent={ceo}
                  emotion={emocionDe(ceo.key)}
                  highlighted={resaltado === ceo.key}
                  destacado
                />
              )}

              {/* Resto del equipo */}
              {equipo.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {equipo.map((a) => (
                    <DeskCard
                      key={a.key}
                      agent={a}
                      emotion={emocionDe(a.key)}
                      highlighted={resaltado === a.key}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Derecha — Centro de comandos (~30%) */}
          <section className="space-y-4 lg:col-span-3">
            {/* Input de orden */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
                Centro de comandos
              </h2>
              <textarea
                value={orden}
                onChange={(e) => setOrden(e.target.value)}
                onKeyDown={onKeyDown}
                rows={3}
                placeholder="Dale una orden al equipo…  (ej: cobrale la seña al cliente nuevo)"
                className="w-full resize-none rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
              />
              <button
                onClick={enviarOrden}
                disabled={enviando || !orden.trim()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-400 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {enviando ? 'Mr Go está pensando…' : 'Enviar orden'}
              </button>

              <label className="mt-3 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ejecutarEnVivo}
                  onChange={(e) => setEjecutarEnVivo(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                />
                <span className="text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    Ejecutar la acción en vivo
                  </span>{' '}
                  — efectúa de verdad (p. ej. envía WhatsApp). Si está apagado, solo se simula.
                </span>
              </label>
            </div>

            {/* Feed — Lo que está pasando */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                <Radio className="h-4 w-4 text-brand-400" />
                Lo que está pasando
              </h2>

              {feed.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Todavía no diste ninguna orden. Escribí arriba y Mr Go repartirá el trabajo.
                </p>
              ) : (
                <ul className="space-y-3">
                  {feed.map((ev) => (
                    <li
                      key={ev.id}
                      className="rounded-lg border border-slate-700 bg-slate-900/40 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0">
                          <MrGoAvatar color={colorKeyForAgent(ev.agentKey)} emotion={ev.emotion} size={44} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-white">
                              {ev.agentNombre}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-500">{ev.hora}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">{ev.reasoning}</p>

                          {ev.toolNombre && (
                            <div className="mt-2 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-[11px] text-amber-300">
                                  <Wrench className="h-3 w-3 text-amber-400" />
                                  {ev.toolNombre}
                                </span>
                                {ev.execution && (
                                  <span
                                    className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusBadge(ev.execution.status).cls}`}
                                  >
                                    {statusBadge(ev.execution.status).label}
                                  </span>
                                )}
                              </div>
                              {ev.execution && (
                                <p className="mt-1 text-[10px] text-slate-400">{ev.execution.detail}</p>
                              )}
                            </div>
                          )}

                          {ev.esFallback && (
                            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                              <Info className="h-3 w-3" />
                              Decisión por defecto (sin motor de IA configurado).
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Memoria de Mr Go */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
                <Brain className="h-4 w-4 text-brand-400" />
                Memoria de Mr Go
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Lo que Mr Go sabe de tu negocio. Lo usa para decidir y responder mejor.
              </p>

              {/* Perfil del negocio */}
              <label className="mb-1 block text-xs font-medium text-slate-400">Perfil del negocio</label>
              <textarea
                value={memProfile}
                onChange={(e) => setMemProfile(e.target.value.slice(0, MEMORY_PROFILE_MAX))}
                rows={5}
                maxLength={MEMORY_PROFILE_MAX}
                placeholder="Contá qué es tu negocio, el tono, reglas…"
                className="w-full resize-none rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
              />
              <div className="mt-1 text-right text-[10px] text-slate-500">
                {memProfile.length}/{MEMORY_PROFILE_MAX}
              </div>

              {/* Hechos / notas */}
              <div className="mt-3 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-400">Hechos y notas</label>
                <span className="text-[10px] text-slate-500">
                  {memFacts.length}/{MEMORY_FACTS_MAX}
                </span>
              </div>

              {memFacts.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">Todavía no hay hechos cargados.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {memFacts.map((fact, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/40 px-2.5 py-2"
                    >
                      <span className="min-w-0 flex-1 break-words text-xs text-slate-300">{fact}</span>
                      <button
                        type="button"
                        onClick={() => borrarHecho(i)}
                        aria-label="Borrar hecho"
                        className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Agregar un hecho nuevo */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={nuevoHecho}
                  onChange={(e) => setNuevoHecho(e.target.value.slice(0, MEMORY_FACT_MAX))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      agregarHecho();
                    }
                  }}
                  maxLength={MEMORY_FACT_MAX}
                  placeholder="Agregá un hecho (ej: atendemos de 9 a 18)"
                  disabled={memFacts.length >= MEMORY_FACTS_MAX}
                  className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={agregarHecho}
                  disabled={!nuevoHecho.trim() || memFacts.length >= MEMORY_FACTS_MAX}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-600 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Agregar hecho
                </button>
              </div>
              {memFacts.length >= MEMORY_FACTS_MAX && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Llegaste al máximo de {MEMORY_FACTS_MAX} hechos.
                </p>
              )}

              {/* Guardar */}
              <button
                type="button"
                onClick={guardarMemoria}
                disabled={guardandoMem}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-400 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
              >
                {guardandoMem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {guardandoMem ? 'Guardando…' : 'Guardar memoria'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta de "escritorio" de un agente: su avatar Mr Go + nombre + rol. Se
 * ilumina (borde brand) cuando el orquestador le derivó la última orden.
 */
function DeskCard({
  agent,
  emotion,
  highlighted,
  destacado = false,
}: {
  agent: DeskAgent;
  emotion: MrGoEmotion;
  highlighted: boolean;
  destacado?: boolean;
}) {
  return (
    <div
      className={[
        'flex flex-col items-center rounded-xl border p-4 text-center transition-all',
        destacado ? 'bg-brand-400/5' : 'bg-slate-900/30',
        highlighted
          ? 'border-brand-400 ring-2 ring-brand-400/40 shadow-lg shadow-brand-400/10'
          : 'border-slate-700',
      ].join(' ')}
    >
      <MrGoAvatar
        color={colorKeyForAgent(agent.key)}
        emotion={emotion}
        size={destacado ? 120 : 72}
        pet={destacado}
        label={`${agent.nombre} (${emotion})`}
      />
      <h3 className={`mt-2 font-semibold text-white ${destacado ? 'text-base' : 'text-sm'}`}>
        {agent.nombre}
      </h3>
      {agent.descripcion && (
        <p className={`mt-0.5 text-slate-400 ${destacado ? 'text-xs max-w-md' : 'text-[11px] line-clamp-2'}`}>
          {agent.descripcion}
        </p>
      )}
    </div>
  );
}
