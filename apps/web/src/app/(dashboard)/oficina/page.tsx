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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send, Loader2, Building2, Radio, AlertTriangle, Brain, Plus, Trash2, Save, Users,
  Terminal, Gauge, CheckSquare, Bell, Zap, Share2, Activity as ActivityIcon, Sparkles, Thermometer,
  Pause, Play, Palette, Smile, Heart, Glasses, Shirt, Check, Pencil, Wand2, Store, ExternalLink,
} from 'lucide-react';
import { MrGoAvatar } from '@/components/mrgo/MrGoAvatar';
import { OfficeFloor, buildOfficeLayout, petForRole, type RoomAgent } from '@/components/mrgo/OfficeFloor';
import { useOfficeLife } from '@/components/mrgo/useOfficeLife';
import { AgentCard } from '@/components/mrgo/AgentCard';
import { CommandPanel, type CommandPanelAgent } from '@/components/mrgo/CommandPanel';
import { useAgentActivity } from '@/components/mrgo/useAgentActivity';
import {
  MR_GO_COLORS,
  MR_GO_COLOR_ORDER,
  MR_GO_PETS,
  type MrGoEmotion,
  type MrGoColorKey,
  type MrGoPetKey,
} from '@/components/mrgo/types';
import {
  getMrGoAgents,
  runMrGo,
  resumeMrGo,
  getMrGoMemory,
  saveMrGoMemory,
  getMrGoOffice,
  saveMrGoOffice,
  getMrGoIndustry,
  saveMrGoIndustry,
  saveMrGoAgents,
  colorKeyForAgent,
  mapEmotion,
  CEO_AGENT_KEY,
  PET_NONE,
  type MrGoAgentConfig,
  type MrGoRole,
  type MrGoTool,
  type AgentStep,
  type PendingAction,
  type StopReason,
  type ActionResult,
} from '@/lib/api/mrgo';
import { getIndustryTemplates, type IndustryTemplate } from '@/lib/api/industryTemplates';
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

/** Un evento del feed "Lo que está pasando": una CORRIDA del loop agéntico. */
interface FeedEvent {
  id: string;
  agentKey: string;
  agentNombre: string;
  /** La orden original (para reanudar la cadena tras confirmar). */
  text: string;
  /** Canal de origen de la orden, si lo hubo. */
  channel?: string;
  emotion: MrGoEmotion;
  /** Respuesta final de Mr Go (vacía si pausó por confirmación). */
  finalMessage: string;
  /** Traza de pasos ejecutados/simulados, en orden. */
  steps: AgentStep[];
  stoppedReason: StopReason;
  /** Acción pendiente de confirmación (externa en vivo), si la hay. */
  pending?: PendingAction;
  /** Resultado tras confirmar la acción pendiente (una vez aprobada). */
  pendingResult?: ActionResult | null;
  /** true si el motor de IA no estaba disponible (no_engine). */
  esFallback: boolean;
  hora: string;
}

// Tools permitidos por rol (espeja ROLE_TOOLS del backend: services/mrgo/agents.ts).
// El CEO coordina y puede todo (se resuelve con el catálogo completo).
const ROLE_TOOL_KEYS: Record<string, string[]> = {
  ventas: ['generar_link_pago', 'crear_cliente', 'enviar_whatsapp'],
  finanzas: ['generar_link_pago'],
  reservas: ['crear_reserva', 'enviar_whatsapp'],
  cobros: ['generar_link_pago', 'enviar_whatsapp'],
  soporte: ['enviar_whatsapp'],
  inbox: ['enviar_whatsapp'],
  crm: ['mover_lifecycle', 'crear_cliente'],
  marketing: ['lanzar_campana'],
  campanas: ['lanzar_campana', 'enviar_whatsapp'],
};

// Límites de la memoria de Mr Go (espejan los del backend).
const MEMORY_PROFILE_MAX = 2000;
const MEMORY_FACT_MAX = 300;
const MEMORY_FACTS_MAX = 50;

// ─── Studio "Tu Mr Go": catálogos de personalización para el panel ──────────
/** Etiqueta en español de cada expresión (para chips/labels del Studio). */
const EMOTION_LABELS: Record<MrGoEmotion, string> = {
  happy: 'Feliz',
  working: 'Trabajando',
  thinking: 'Pensando',
  nerd: 'Concentrado',
  angry: 'Enojado',
  sleepy: 'Durmiendo',
  love: 'Encantado',
};
/** Expresiones ofrecidas en el Studio (espejan el mockup "modelo 1"). */
const STUDIO_EMOTIONS: MrGoEmotion[] = ['happy', 'thinking', 'nerd', 'angry', 'sleepy', 'love'];
/** Mascotas elegibles (el "ninguna" se agrega aparte en el panel). */
const STUDIO_PETS: MrGoPetKey[] = ['jinx', 'rayito', 'relojito', 'billetin', 'cerebrito', 'megafonito'];

/** Pestañas del COMMAND CENTER (réplica del panel de Munder Difflin). */
type CmdTab =
  | 'terminal' | 'monitor' | 'tasks' | 'askme' | 'triggers'
  | 'memory' | 'graph' | 'activity' | 'skills' | 'temps';

const CMD_TABS: { key: CmdTab; label: string; icon: typeof Terminal }[] = [
  { key: 'terminal', label: 'terminal', icon: Terminal },
  { key: 'monitor', label: 'monitor', icon: Gauge },
  { key: 'tasks', label: 'tasks', icon: CheckSquare },
  { key: 'askme', label: 'ask me', icon: Bell },
  { key: 'triggers', label: 'triggers', icon: Zap },
  { key: 'memory', label: 'memory', icon: Brain },
  { key: 'graph', label: 'graph', icon: Share2 },
  { key: 'activity', label: 'activity', icon: ActivityIcon },
  { key: 'skills', label: 'skills', icon: Sparkles },
  { key: 'temps', label: 'temps', icon: Thermometer },
];

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
  // Escritorio seleccionado por click (abre el panel del agente).
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  // Señal de delegación para el piso: al cambiar el nonce, vuela un sobre
  // del CEO al agente que atendió la orden.
  const [delivery, setDelivery] = useState<{ to: string; nonce: number } | null>(null);
  // Agentes pausados (solo foco visual de la oficina; no cambia el backend).
  const [pausados, setPausados] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  // Id del evento cuya acción pendiente se está confirmando (para el spinner).
  const [confirmando, setConfirmando] = useState<string | null>(null);
  // Pestaña activa del COMMAND CENTER (réplica del panel de Munder Difflin).
  const [cmdTab, setCmdTab] = useState<CmdTab>('monitor');
  const ordenRef = useRef<HTMLTextAreaElement>(null);

  // Actividad en vivo de cada Mr Go: la máquina de estados que reproduce la
  // traza real de la corrida (pensando → trabajando → listo) sobre cada tarjeta.
  const { activity, play, reset: resetActivity } = useAgentActivity();

  // Memoria de Mr Go (profile + facts). Se carga aparte de los agentes.
  const [memProfile, setMemProfile] = useState('');
  const [memFacts, setMemFacts] = useState<string[]>([]);
  const [nuevoHecho, setNuevoHecho] = useState('');
  const [guardandoMem, setGuardandoMem] = useState(false);

  // ─── Studio "Tu Mr Go" ──────────────────────────────────────────────────
  // Qué agente se está personalizando (default: el CEO/principal) + el borrador
  // de los campos (se sincroniza con la config guardada al cambiar de agente).
  const [studioKey, setStudioKey] = useState<string>(CEO_AGENT_KEY);
  const [studioNombre, setStudioNombre] = useState('');
  const [studioColor, setStudioColor] = useState<MrGoColorKey>('LILA');
  const [studioEmotion, setStudioEmotion] = useState<MrGoEmotion>('happy');
  const [studioPet, setStudioPet] = useState<MrGoPetKey | 'none'>('none');
  const [guardandoStudio, setGuardandoStudio] = useState(false);

  // ─── Giro del negocio ("bots por giro") ─────────────────────────────────
  // Catálogo de los 14 rubros + el giro elegido. Mr Go adopta el tono del rubro.
  const [giros, setGiros] = useState<IndustryTemplate[]>([]);
  const [giroId, setGiroId] = useState('');
  const [guardandoGiro, setGuardandoGiro] = useState(false);

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

  // Carga el estado persistente de la oficina (qué agentes están en pausa) al
  // montar, para que las pausas vuelvan igual tras recargar. Silencioso.
  useEffect(() => {
    let activo = true;
    getMrGoOffice()
      .then((office) => {
        if (activo && Array.isArray(office.paused)) setPausados(new Set(office.paused));
      })
      .catch(() => {
        /* estado de oficina opcional: si falla, arranca sin pausas */
      });
    return () => {
      activo = false;
    };
  }, []);

  // Carga el catálogo de giros + el giro elegido del negocio ("bots por giro").
  // Silencioso: si falla, la sección de giro queda vacía y no bloquea la Oficina.
  useEffect(() => {
    let activo = true;
    Promise.all([getIndustryTemplates(), getMrGoIndustry()])
      .then(([catalogo, actual]) => {
        if (!activo) return;
        setGiros(Array.isArray(catalogo) ? catalogo : []);
        setGiroId(actual?.giroId ?? '');
      })
      .catch(() => {
        /* giro opcional */
      });
    return () => {
      activo = false;
    };
  }, []);

  /** Elige (o limpia) el giro del negocio y lo persiste. Mr Go adopta el tono. */
  async function elegirGiro(id: string) {
    if (guardandoGiro) return;
    const nuevo = giroId === id ? '' : id; // click en el actual = limpiar
    setGuardandoGiro(true);
    try {
      const saved = await saveMrGoIndustry(nuevo);
      setGiroId(saved.giroId);
      const nombre = giros.find((g) => g.id === saved.giroId)?.nombre;
      toast({
        type: 'success',
        message: saved.giroId ? `Giro: ${nombre}. Mr Go hablará en ese tono.` : 'Giro quitado.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('403') || /forbidden/i.test(msg)) {
        toast({ type: 'error', message: 'Solo un admin puede cambiar el giro.' });
      } else {
        toast({ type: 'error', message: msg || 'No se pudo guardar el giro.' });
      }
    } finally {
      setGuardandoGiro(false);
    }
  }

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

  // Sincroniza el borrador del Studio con la config guardada del agente elegido
  // (al cambiar de agente o tras guardar/recargar). El nombre vacío = usar el
  // del catálogo (el input muestra ese nombre como placeholder).
  useEffect(() => {
    const cfg = agents.find((a) => a.key === studioKey);
    setStudioNombre(cfg?.nombre ?? '');
    setStudioColor((cfg?.colorKey as MrGoColorKey) ?? colorKeyForAgent(studioKey));
    setStudioEmotion((cfg?.emotion as MrGoEmotion) ?? 'happy');
    const defPet: MrGoPetKey | undefined =
      studioKey === CEO_AGENT_KEY ? 'jinx' : petForRole(studioKey);
    setStudioPet((cfg?.pet as MrGoPetKey | 'none') ?? defPet ?? PET_NONE);
  }, [studioKey, agents]);

  /** Guarda la personalización del agente del Studio (merge sobre la config). */
  async function guardarStudio() {
    if (guardandoStudio) return;
    setGuardandoStudio(true);
    try {
      const next: MrGoAgentConfig[] = agents.map((a) =>
        a.key === studioKey
          ? {
              ...a,
              nombre: studioNombre.trim() || undefined,
              colorKey: studioColor,
              emotion: studioEmotion,
              pet: studioPet,
            }
          : a,
      );
      const res = await saveMrGoAgents(next);
      setAgents(res.agents);
      const label = studioNombre.trim() || roleByKey.get(studioKey)?.nombre || 'agente';
      toast({ type: 'success', message: `Tu Mr Go guardado: ${label} actualizado.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('403') || /forbidden/i.test(msg)) {
        toast({ type: 'error', message: 'Solo un admin puede personalizar los agentes.' });
      } else {
        toast({ type: 'error', message: msg || 'No se pudo guardar la personalización.' });
      }
    } finally {
      setGuardandoStudio(false);
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

  // Motor + modelo de IA por agente (para la tarjeta rica). Opcionales: si el
  // agente no los define, la tarjeta muestra "Motor del negocio".
  const engineByKey = useMemo(() => {
    const m = new Map<string, { engine?: string; model?: string }>();
    for (const a of agents) m.set(a.key, { engine: a.llmProvider, model: a.llmModel });
    return m;
  }, [agents]);

  // Config cruda por agente (incluye la personalización del Studio).
  const configByKey = useMemo(() => {
    const m = new Map<string, MrGoAgentConfig>();
    for (const a of agents) m.set(a.key, a);
    return m;
  }, [agents]);

  // ─── Resolución del "sobre visual" por agente ──────────────────────────────
  // La personalización guardada (Studio) gana; si falta, se cae al default del
  // rol (color por AGENT_COLOR_KEYS, mascota por petForRole, nombre del catálogo).

  /** Color del cuerpo del agente (personalizado o el del rol). */
  function colorOf(key: string): MrGoColorKey {
    return (configByKey.get(key)?.colorKey as MrGoColorKey | undefined) ?? colorKeyForAgent(key);
  }
  /** Mascota del agente: personalizada, 'none' = sin mascota, o la del rol. */
  function petOf(key: string): MrGoPetKey | undefined {
    const p = configByKey.get(key)?.pet;
    if (p === PET_NONE) return undefined;
    if (p) return p as MrGoPetKey;
    return key === CEO_AGENT_KEY ? 'jinx' : petForRole(key);
  }
  /** Nombre a mostrar del agente (personalizado o el del catálogo de roles). */
  function nombreOf(key: string): string {
    const n = configByKey.get(key)?.nombre?.trim();
    return n || roleByKey.get(key)?.nombre || key;
  }

  // Evento más reciente del agente seleccionado: alimenta el CommandPanel
  // (log de pasos + acción pendiente de ese agente).
  const selEvent = useMemo(
    () => (seleccionado ? feed.find((e) => e.agentKey === seleccionado) ?? null : null),
    [seleccionado, feed],
  );

  // Datos del agente seleccionado para el CommandPanel (null = estado vacío).
  const selAgent: CommandPanelAgent | null = useMemo(() => {
    if (!seleccionado) return null;
    const role = roleByKey.get(seleccionado);
    const eng = engineByKey.get(seleccionado);
    const rol =
      seleccionado === CEO_AGENT_KEY
        ? 'Director'
        : role?.descripcion
          ? role.descripcion.split(/[,.]/)[0]
          : 'Agente';
    return {
      key: seleccionado,
      nombre: nombreOf(seleccionado),
      rol,
      color: colorOf(seleccionado),
      engine: eng?.engine,
      model: eng?.model,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado, roleByKey, engineByKey, configByKey]);

  // Agentes activos listos para pintar, con CEO siempre primero.
  const { ceo, equipo } = useMemo(() => {
    const activos: DeskAgent[] = agents
      .filter((a) => a.activo)
      .map((a) => {
        const role = roleByKey.get(a.key);
        return {
          key: a.key,
          nombre: nombreOf(a.key),
          descripcion: role?.descripcion ?? '',
          activo: a.activo,
        };
      });
    return {
      ceo: activos.find((a) => a.key === CEO_AGENT_KEY) ?? null,
      equipo: activos.filter((a) => a.key !== CEO_AGENT_KEY),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, roleByKey, configByKey]);

  /** Emoción a mostrar: override de la última orden, o la expresión en reposo
   *  elegida en el Studio, o 'working' por defecto. */
  function emocionDe(key: string): MrGoEmotion {
    return emociones[key] ?? configByKey.get(key)?.emotion ?? 'working';
  }

  /** Nombres de los tools que un rol puede ejecutar (CEO = todos). */
  function toolsForRole(key: string): string[] {
    const keys = key === CEO_AGENT_KEY ? tools.map((t) => t.key) : ROLE_TOOL_KEYS[key] ?? [];
    return keys.map((k) => toolByKey.get(k)?.nombre ?? k);
  }

  // Agentes para la escena de la oficina (CEO con flag director, va al centro).
  const roomAgents: RoomAgent[] = useMemo(() => {
    const list: RoomAgent[] = [];
    if (ceo) {
      list.push({
        key: ceo.key,
        nombre: ceo.nombre,
        rol: 'Director',
        color: colorOf(ceo.key),
        emotion: emocionDe(ceo.key),
        pet: petOf(ceo.key),
        highlighted: resaltado === ceo.key,
        director: true,
        paused: pausados.has(ceo.key),
        tools: toolsForRole(ceo.key),
      });
    }
    for (const a of equipo) {
      list.push({
        key: a.key,
        nombre: a.nombre,
        rol: a.descripcion ? a.descripcion.split(/[,.]/)[0] : 'Agente',
        color: colorOf(a.key),
        emotion: emocionDe(a.key),
        pet: petOf(a.key),
        highlighted: resaltado === a.key,
        paused: pausados.has(a.key),
        tools: toolsForRole(a.key),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceo, equipo, emociones, resaltado, pausados, tools, toolByKey, configByKey]);

  // Layout del piso + "vida" (los agentes caminan al café / reunión y vuelven).
  const layout = useMemo(() => buildOfficeLayout(roomAgents), [roomAgents]);
  const life = useOfficeLife({
    keys: roomAgents.map((a) => a.key),
    deskSpots: layout.deskSpots,
    coffeeSpot: layout.coffeeSpot,
    meetingSpots: layout.meetingSpots,
    paused: pausados,
    enabled: true,
  });

  /** Pausar / reactivar un agente (foco visual de la oficina). Persiste el nuevo
   *  estado para que las pausas vuelvan igual tras recargar. */
  function togglePausa(key: string) {
    const next = new Set(pausados);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPausados(next);
    saveMrGoOffice({ paused: [...next] }).catch(() => {
      toast({ type: 'error', message: 'No se pudo guardar el estado de la oficina.' });
    });
  }

  /** Darle una orden directa a un agente: prefija el comando y enfoca. */
  function ordenarAAgente(key: string) {
    const nombre = roleByKey.get(key)?.nombre ?? key;
    setOrden((prev) => (prev.trim() ? prev : `${nombre}: `));
    setSeleccionado(null);
    requestAnimationFrame(() => {
      const el = ordenRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  /** Nombre legible de un tool (del catálogo) o su clave si no está. */
  function toolNombre(key: string): string {
    return toolByKey.get(key)?.nombre ?? key;
  }

  async function enviarOrden() {
    const text = orden.trim();
    if (!text || enviando) return;
    setEnviando(true);
    try {
      // El loop encadena tools hasta resolver o pausar. execute=true → en vivo
      // (las acciones externas pausan esperando confirmación).
      const res = await runMrGo(text, undefined, ejecutarEnVivo);
      const role = roleByKey.get(res.agent);
      const emotion = mapEmotion(res.emotion);
      const esFallback = res.stoppedReason === 'no_engine';

      // Ilumina el escritorio del agente que corrió, lo selecciona (para que el
      // CommandPanel muestre su detalle) y actualiza su emoción.
      setResaltado(res.agent);
      setSeleccionado(res.agent);
      setEmociones((prev) => ({ ...prev, [res.agent]: emotion }));

      // Reproduce la traza real sobre la tarjeta del agente (pensando →
      // trabajando por cada tool → listo / espera-tu-OK / error). Si no hubo
      // motor de IA no reproducimos nada: la tarjeta queda "Disponible".
      if (!esFallback) {
        play(res.agent, res.steps, { stoppedReason: res.stoppedReason });
        // Dispara el sobre CEO → agente en el piso (delegación).
        setDelivery({ to: res.agent, nonce: Date.now() });
      }

      const evento: FeedEvent = {
        id: crypto.randomUUID(),
        agentKey: res.agent,
        agentNombre: role?.nombre ?? res.agent,
        text,
        emotion,
        finalMessage: res.finalMessage,
        steps: res.steps,
        stoppedReason: res.stoppedReason,
        pending: res.pending,
        esFallback,
        hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      };
      setFeed((prev) => [evento, ...prev].slice(0, 30));
      setOrden('');

      // Si el CEO delegó en un especialista, avisamos en quién (además del sobre
      // que vuela CEO→agente en la oficina).
      if (res.delegation) {
        toast({ type: 'info', message: `Mr Go delegó en ${role?.nombre ?? res.agent}.` });
      }

      if (esFallback) {
        toast({ type: 'info', message: 'Sin motor de IA configurado: Mr Go no pudo ejecutar la orden.' });
      } else if (res.stoppedReason === 'needs_confirmation') {
        toast({ type: 'info', message: `Mr Go dejó una acción esperando tu confirmación.` });
      } else {
        toast({ type: 'success', message: `Mr Go resolvió la orden en ${res.steps.length} paso(s).` });
      }
    } catch (err) {
      toast({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo enviar la orden al equipo.',
      });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Confirma la acción pendiente y REANUDA la cadena: ejecuta la acción aprobada
   * en vivo y deja que Mr Go siga el loop hasta cerrar o volver a pausar en otra
   * acción externa. Reproduce la continuación sobre el mismo agente.
   */
  async function confirmarPendiente(ev: FeedEvent) {
    if (!ev.pending || confirmando) return;
    setConfirmando(ev.id);
    try {
      const res = await resumeMrGo(
        { tool: ev.pending.tool, params: ev.pending.params, thought: ev.pending.thought },
        { text: ev.text, channel: ev.channel, agentKey: ev.agentKey, steps: ev.steps, maxSteps: 10 },
      );
      // Actualiza el evento con la cadena continuada (nueva traza + estado final o
      // una nueva acción pendiente si volvió a pausar).
      setFeed((prev) =>
        prev.map((e) =>
          e.id === ev.id
            ? {
                ...e,
                steps: res.steps,
                finalMessage: res.finalMessage,
                stoppedReason: res.stoppedReason,
                pending: res.pending,
                pendingResult: undefined,
              }
            : e,
        ),
      );
      // Reproduce la continuación en la oficina (mismo agente sigue trabajando).
      play(res.agent, res.steps, { stoppedReason: res.stoppedReason });
      if (res.stoppedReason === 'needs_confirmation') {
        toast({ type: 'info', message: 'Mr Go dejó otra acción esperando tu confirmación.' });
      } else {
        // Terminó la cadena: el agente vuelve a su escritorio.
        resetActivity(ev.agentKey);
        toast({
          type: 'success',
          message: res.finalMessage ? `Listo: ${res.finalMessage}` : 'Acción confirmada y ejecutada.',
        });
      }
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo confirmar la acción.' });
    } finally {
      setConfirmando(null);
    }
  }

  /** Descarta la acción pendiente sin ejecutarla. */
  function cancelarPendiente(ev: FeedEvent) {
    setFeed((prev) => prev.map((e) => (e.id === ev.id ? { ...e, pending: undefined } : e)));
    // El agente deja de esperar en su estación y vuelve al escritorio.
    resetActivity(ev.agentKey);
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
    <div className="space-y-6 rounded-2xl bg-[#f4efe6] p-4 sm:p-6">
      {/* Barra superior estilo Munder Difflin: logo + estado + "auto" */}
      <div className="flex items-center justify-between rounded-xl border border-[#e7e0d2] bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7c3aed]/10">
            <Building2 className="h-5 w-5 text-[#7c3aed]" />
          </span>
          <div className="leading-tight">
            <span className="text-sm font-bold text-[#3a322a]">Mr Go</span>
            <span className="ml-1.5 text-xs font-medium text-[#a99d87]">· Centro de operaciones</span>
          </div>
          <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            <Radio className="h-3 w-3" /> auto
          </span>
        </div>
        <span className="hidden text-xs text-[#a99d87] sm:block">
          {(ceo ? 1 : 0) + equipo.length} agentes · Mr Go dirige la oficina
        </span>
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
            <div className="rounded-xl border border-[#e7e0d2] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#4a4034]">
                  La oficina
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    <Radio className="h-3 w-3" />
                    En vivo
                  </span>
                </h2>
                <span className="text-xs text-[#a99d87]">
                  {(ceo ? 1 : 0) + equipo.length} en funciones
                </span>
              </div>

              <OfficeFloor
                agents={roomAgents}
                life={life}
                selectedKey={seleccionado}
                onSelect={(key) => setSeleccionado((prev) => (prev === key ? null : key))}
                onOrderAgent={ordenarAAgente}
                onTogglePause={togglePausa}
                showDetailPanel={false}
                activity={activity}
                delivery={delivery}
              />
            </div>
          </section>

          {/* Derecha — COMMAND CENTER con pestañas (réplica de Munder Difflin) */}
          <section className="lg:col-span-3">
            <div className="sticky top-4 overflow-hidden rounded-xl border border-[#e7e0d2] bg-white shadow-sm">
              {/* Cabecera del panel */}
              <div className="flex items-center justify-between gap-2 border-b border-[#e7e0d2] bg-[#faf7f0] px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="shrink-0">
                    <MrGoAvatar color="LILA" emotion="happy" size={30} alive={false} />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#3a322a]">
                        Command Center
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                        ● live
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-[#a99d87]">Mr Go dirige la oficina</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-md border border-[#ddd4c4] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#857a66]">
                  auto
                </span>
              </div>

              {/* Fila de pestañas (2 filas de 5, estilo MD) */}
              <div className="grid grid-cols-5 gap-1 border-b border-[#e7e0d2] bg-[#faf7f0] p-1.5">
                {CMD_TABS.map((t) => {
                  const active = cmdTab === t.key;
                  const Icon = t.icon;
                  const badge = t.key === 'askme' ? feed.filter((e) => e.pending && !e.pendingResult).length : 0;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setCmdTab(t.key)}
                      className={`relative flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors ${
                        active ? 'bg-[#e8692a] text-white shadow-sm' : 'text-[#857a66] hover:bg-[#f0e9db]'
                      }`}
                      title={t.label}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden truncate xl:inline">{t.label}</span>
                      {badge > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Contenido de la pestaña activa */}
              <div className="p-4">
                {/* MONITOR — despachar orden + motor por agente */}
                {cmdTab === 'monitor' && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-[#857a66]">
                        Despachar — vía Mr Go
                      </h3>
                      <textarea
                        ref={ordenRef}
                        value={orden}
                        onChange={(e) => setOrden(e.target.value)}
                        onKeyDown={onKeyDown}
                        rows={3}
                        placeholder="Describí la tarea… (Mr Go la reparte al agente indicado)"
                        className="w-full resize-none rounded-lg border border-[#ddd4c4] bg-[#f6f2ea] px-3 py-2 text-sm text-[#3a322a] placeholder:text-[#a99d87] focus:border-[#e8692a] focus:outline-none"
                      />
                      <button
                        onClick={enviarOrden}
                        disabled={enviando || !orden.trim()}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#e8692a] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d25e22] disabled:opacity-50"
                      >
                        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {enviando ? 'Mr Go está pensando…' : 'Despachar orden'}
                      </button>
                      <label className="mt-3 flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={ejecutarEnVivo}
                          onChange={(e) => setEjecutarEnVivo(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[#ddd4c4] bg-[#f6f2ea] text-red-500 focus:ring-red-500"
                        />
                        <span className="text-xs text-[#857a66]">
                          <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            Ejecutar en vivo
                          </span>{' '}
                          — efectúa de verdad (p. ej. envía WhatsApp). Apagado = solo simula.
                        </span>
                      </label>
                    </div>

                    <div>
                      <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-[#857a66]">
                        Agentes
                      </h3>
                      <ul className="space-y-1.5">
                        {[...(ceo ? [ceo] : []), ...equipo].map((a) => {
                          const act = activity[a.key];
                          const working = Boolean(act && ['working', 'thinking', 'alert'].includes(act.state));
                          const paused = pausados.has(a.key);
                          return (
                            <li
                              key={a.key}
                              className={`flex items-center gap-2 rounded-lg border border-[#e7e0d2] bg-[#faf7f0] px-2.5 py-1.5 ${paused ? 'opacity-60' : ''}`}
                            >
                              <MrGoAvatar color={colorOf(a.key)} emotion={emocionDe(a.key)} size={22} alive={!paused} />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#3a322a]">{a.nombre}</span>
                              <span className="shrink-0 font-mono text-[10px] text-[#a99d87]">
                                {engineByKey.get(a.key)?.model ?? 'motor'}
                              </span>
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${paused ? 'bg-[#cdbfa6]' : working ? 'bg-emerald-500' : 'bg-[#cdbfa6]'}`}
                              />
                              <button
                                type="button"
                                onClick={() => togglePausa(a.key)}
                                aria-label={paused ? `Reactivar ${a.nombre}` : `Pausar ${a.nombre}`}
                                title={paused ? 'Reactivar' : 'Pausar'}
                                className="shrink-0 rounded p-1 text-[#a99d87] transition-colors hover:bg-[#ece5d8] hover:text-[#857a66]"
                              >
                                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}

                {/* TERMINAL — detalle del agente seleccionado + log + confirmación */}
                {cmdTab === 'terminal' && (
                  <div className="-m-4">
                    <CommandPanel
                      agent={selAgent}
                      activity={seleccionado ? activity[seleccionado] : undefined}
                      steps={selEvent?.steps}
                      pending={selEvent?.pending ?? null}
                      confirming={selEvent ? confirmando === selEvent.id : false}
                      toolLabel={toolNombre}
                      onConfirm={selEvent ? () => confirmarPendiente(selEvent) : undefined}
                      onDiscard={selEvent ? () => cancelarPendiente(selEvent) : undefined}
                    />
                  </div>
                )}

                {/* TASKS — tablero kanban TODO / DOING / BLOCKED */}
                {cmdTab === 'tasks' && (
                  <div className="grid grid-cols-3 gap-2">
                    {(() => {
                      const doing = [...(ceo ? [ceo] : []), ...equipo].filter((a) => {
                        const s = activity[a.key]?.state;
                        return s === 'working' || s === 'thinking' || s === 'alert';
                      });
                      const blocked = feed.filter((e) => e.pending && !e.pendingResult);
                      const cols = [
                        {
                          label: 'TODO',
                          head: 'bg-sky-500/15 text-sky-700',
                          items: (
                            <p className="px-1 py-6 text-center text-[10px] text-[#a99d87]">
                              Despachá trabajo desde Monitor.
                            </p>
                          ),
                        },
                        {
                          label: 'DOING',
                          head: 'bg-amber-500/15 text-amber-700',
                          items:
                            doing.length === 0 ? (
                              <p className="px-1 py-6 text-center text-[10px] text-[#a99d87]">—</p>
                            ) : (
                              doing.map((a) => (
                                <div key={a.key} className="rounded-md border border-[#e7e0d2] bg-white p-2">
                                  <div className="flex items-center gap-1.5">
                                    <MrGoAvatar color={colorOf(a.key)} emotion="working" size={18} alive={false} />
                                    <span className="truncate text-[11px] font-medium text-[#3a322a]">{a.nombre}</span>
                                  </div>
                                  <p className="mt-1 truncate text-[10px] text-[#857a66]">
                                    {activity[a.key]?.currentTool ? toolNombre(activity[a.key]!.currentTool!) : 'Trabajando…'}
                                  </p>
                                </div>
                              ))
                            ),
                        },
                        {
                          label: 'BLOCKED',
                          head: 'bg-red-500/15 text-red-700',
                          items:
                            blocked.length === 0 ? (
                              <p className="px-1 py-6 text-center text-[10px] text-[#a99d87]">—</p>
                            ) : (
                              blocked.map((ev) => (
                                <button
                                  key={ev.id}
                                  type="button"
                                  onClick={() => setCmdTab('askme')}
                                  className="w-full rounded-md border border-red-200 bg-red-50 p-2 text-left"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <MrGoAvatar color={colorOf(ev.agentKey)} emotion={ev.emotion} size={18} alive={false} />
                                    <span className="truncate text-[11px] font-medium text-[#3a322a]">{ev.agentNombre}</span>
                                  </div>
                                  <p className="mt-1 truncate text-[10px] text-[#857a66]">
                                    {ev.pending ? toolNombre(ev.pending.tool) : ''} · espera tu OK
                                  </p>
                                </button>
                              ))
                            ),
                        },
                      ];
                      return cols.map((c) => (
                        <div key={c.label} className="flex flex-col gap-1.5">
                          <div className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${c.head}`}>
                            {c.label}
                          </div>
                          <div className="flex flex-col gap-1.5">{c.items}</div>
                        </div>
                      ));
                    })()}
                  </div>
                )}

                {/* ASK ME — cola de acciones que esperan tu confirmación */}
                {cmdTab === 'askme' && (
                  <div className="space-y-2">
                    {feed.filter((e) => e.pending && !e.pendingResult).length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#a99d87]">
                        Nada espera tu confirmación. Cuando Mr Go quiera hacer algo sensible (cobro, WhatsApp),
                        te lo pregunta acá.
                      </p>
                    ) : (
                      feed
                        .filter((e) => e.pending && !e.pendingResult)
                        .map((ev) => (
                          <div key={ev.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                            <div className="flex items-center gap-2">
                              <MrGoAvatar color={colorOf(ev.agentKey)} emotion={ev.emotion} size={24} alive={false} />
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#3a322a]">{ev.agentNombre}</span>
                              <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#857a66]">
                                {ev.pending ? toolNombre(ev.pending.tool) : ''}
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] text-[#6a5f4e]">Esta acción se ejecuta de verdad. ¿La confirmás?</p>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => confirmarPendiente(ev)}
                                disabled={confirmando === ev.id}
                                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#e8692a] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#d25e22] disabled:opacity-50"
                              >
                                {confirmando === ev.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" />}
                                Confirmar y ejecutar
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelarPendiente(ev)}
                                className="rounded-lg border border-[#ddd4c4] bg-white px-3 py-1.5 text-xs font-medium text-[#857a66] transition-colors hover:bg-[#f0e9db]"
                              >
                                Descartar
                              </button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                )}

                {/* TRIGGERS — enlace a Automatizaciones */}
                {cmdTab === 'triggers' && (
                  <div className="py-4 text-center">
                    <Zap className="mx-auto h-6 w-6 text-[#7c3aed]" />
                    <p className="mt-2 text-xs text-[#857a66]">
                      Reglas que disparan acciones solas (mensaje entrante, nueva reserva, pago…).
                    </p>
                    <a
                      href="/workflows"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#ddd4c4] bg-[#f6f2ea] px-3 py-1.5 text-xs font-medium text-[#4a4034] transition-colors hover:bg-[#ece5d8]"
                    >
                      Abrir Automatizaciones
                    </a>
                  </div>
                )}

                {/* ACTIVITY — registro de lo que está pasando */}
                {cmdTab === 'activity' && (
                  <div>
                    {feed.length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#a99d87]">
                        Todavía no diste ninguna orden. Despachá desde Monitor y Mr Go reparte el trabajo.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {feed.slice(0, 12).map((ev) => (
                          <li key={ev.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSeleccionado(ev.agentKey);
                                setCmdTab('terminal');
                              }}
                              className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                                seleccionado === ev.agentKey
                                  ? 'border-[#e8692a]/60 bg-[#f0e9db]'
                                  : 'border-[#e7e0d2] bg-[#faf7f0] hover:border-[#ddd4c4]'
                              }`}
                            >
                              <div className="shrink-0">
                                <MrGoAvatar color={colorOf(ev.agentKey)} emotion={ev.emotion} size={28} alive={false} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-xs font-medium text-[#3a322a]">{ev.agentNombre}</span>
                                  <span className="shrink-0 text-[10px] text-[#a99d87]">{ev.hora}</span>
                                </div>
                                <p className="truncate text-[11px] text-[#857a66]">
                                  {ev.esFallback
                                    ? 'Sin motor de IA'
                                    : ev.pending
                                      ? 'Dejó una acción esperando tu OK'
                                      : ev.finalMessage || `${ev.steps.length} paso(s)`}
                                </p>
                              </div>
                              {ev.pending && !ev.pendingResult && (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* MEMORY — perfil del negocio + hechos */}
                {cmdTab === 'memory' && (
                  <div>
                    <p className="mb-3 text-xs text-[#a99d87]">
                      Lo que Mr Go sabe de tu negocio. Lo usa para decidir y responder mejor.
                    </p>
                    <label className="mb-1 block text-xs font-medium text-[#857a66]">Perfil del negocio</label>
                    <textarea
                      value={memProfile}
                      onChange={(e) => setMemProfile(e.target.value.slice(0, MEMORY_PROFILE_MAX))}
                      rows={5}
                      maxLength={MEMORY_PROFILE_MAX}
                      placeholder="Contá qué es tu negocio, el tono, reglas…"
                      className="w-full resize-none rounded-lg border border-[#ddd4c4] bg-[#f6f2ea] px-3 py-2 text-sm text-[#3a322a] placeholder:text-[#a99d87] focus:border-[#e8692a] focus:outline-none"
                    />
                    <div className="mt-1 text-right text-[10px] text-[#a99d87]">
                      {memProfile.length}/{MEMORY_PROFILE_MAX}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <label className="text-xs font-medium text-[#857a66]">Hechos y notas</label>
                      <span className="text-[10px] text-[#a99d87]">
                        {memFacts.length}/{MEMORY_FACTS_MAX}
                      </span>
                    </div>
                    {memFacts.length === 0 ? (
                      <p className="mt-2 text-xs text-[#a99d87]">Todavía no hay hechos cargados.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {memFacts.map((fact, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-[#e7e0d2] bg-[#faf7f0] px-2.5 py-2"
                          >
                            <span className="min-w-0 flex-1 break-words text-xs text-[#4a4034]">{fact}</span>
                            <button
                              type="button"
                              onClick={() => borrarHecho(i)}
                              aria-label="Borrar hecho"
                              className="shrink-0 rounded p-1 text-[#a99d87] transition-colors hover:bg-red-500/10 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
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
                        className="min-w-0 flex-1 rounded-lg border border-[#ddd4c4] bg-[#f6f2ea] px-3 py-2 text-sm text-[#3a322a] placeholder:text-[#a99d87] focus:border-[#e8692a] focus:outline-none disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={agregarHecho}
                        disabled={!nuevoHecho.trim() || memFacts.length >= MEMORY_FACTS_MAX}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-[#ddd4c4] bg-[#f6f2ea] px-3 py-2 text-xs font-medium text-[#4a4034] transition-colors hover:bg-[#ece5d8] disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Agregar
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={guardarMemoria}
                      disabled={guardandoMem}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#e8692a] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d25e22] disabled:opacity-50"
                    >
                      {guardandoMem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {guardandoMem ? 'Guardando…' : 'Guardar memoria'}
                    </button>
                  </div>
                )}

                {/* GRAPH — grafo de delegación: Mr Go (CEO) → especialistas */}
                {cmdTab === 'graph' && (
                  <div>
                    <p className="mb-2 text-xs text-[#a99d87]">
                      Mr Go (CEO) coordina y delega en el equipo.
                    </p>
                    {(() => {
                      const ring = equipo;
                      const cx = 160;
                      const cy = 120;
                      const r = 92;
                      const pts = ring.map((a, i) => {
                        const ang = (i / Math.max(1, ring.length)) * Math.PI * 2 - Math.PI / 2;
                        return { a, x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
                      });
                      return (
                        <svg viewBox="0 0 320 240" className="w-full" style={{ maxHeight: 250 }}>
                          {pts.map((p) => (
                            <line key={`l-${p.a.key}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#ddd4c4" strokeWidth={1.5} />
                          ))}
                          {pts.map((p) => (
                            <circle
                              key={`c-${p.a.key}`}
                              cx={p.x}
                              cy={p.y}
                              r={9}
                              fill={roleByKey.get(p.a.key)?.color ?? '#7c3aed'}
                              stroke="#fff"
                              strokeWidth={2}
                            />
                          ))}
                          <circle cx={cx} cy={cy} r={16} fill="#7c3aed" stroke="#fff" strokeWidth={3} />
                          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">
                            CEO
                          </text>
                        </svg>
                      );
                    })()}
                    <p className="mt-2 text-center text-[10px] text-[#a99d87]">
                      {equipo.length} especialistas conectados al CEO
                    </p>
                  </div>
                )}

                {/* SKILLS — herramientas (gating por rol) que puede ejecutar cada agente */}
                {cmdTab === 'skills' && (
                  <div className="space-y-2">
                    <p className="mb-1 text-xs text-[#a99d87]">
                      Herramientas que puede ejecutar cada agente (caja por rol).
                    </p>
                    {[...(ceo ? [ceo] : []), ...equipo].map((a) => {
                      const tls = toolsForRole(a.key);
                      return (
                        <div key={a.key} className="rounded-lg border border-[#e7e0d2] bg-[#faf7f0] p-2">
                          <div className="flex items-center gap-2">
                            <MrGoAvatar color={colorOf(a.key)} emotion="working" size={20} alive={false} />
                            <span className="text-xs font-medium text-[#3a322a]">{a.nombre}</span>
                          </div>
                          {tls.length === 0 ? (
                            <p className="mt-1 pl-7 text-[10px] text-[#a99d87]">Solo coordina / responde.</p>
                          ) : (
                            <div className="mt-1 flex flex-wrap gap-1 pl-7">
                              {tls.map((t) => (
                                <span
                                  key={t}
                                  className="rounded border border-[#ddd4c4] bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#857a66]"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* TEMPS — "temperatura" del equipo: actividad/estado por agente */}
                {cmdTab === 'temps' && (
                  <div className="space-y-1.5">
                    <p className="mb-1 text-xs text-[#a99d87]">Actividad del equipo ahora mismo.</p>
                    {[...(ceo ? [ceo] : []), ...equipo].map((a) => {
                      const st = activity[a.key]?.state;
                      const heat =
                        st === 'working' || st === 'alert'
                          ? { lbl: 'Activo', cls: 'bg-amber-500', w: '90%' }
                          : st === 'thinking'
                            ? { lbl: 'Pensando', cls: 'bg-sky-500', w: '60%' }
                            : st === 'blocked'
                              ? { lbl: 'Bloqueado', cls: 'bg-red-500', w: '100%' }
                              : st === 'success'
                                ? { lbl: 'Listo', cls: 'bg-emerald-500', w: '40%' }
                                : { lbl: pausados.has(a.key) ? 'En pausa' : 'En reposo', cls: 'bg-[#cdbfa6]', w: '15%' };
                      return (
                        <div key={a.key} className="flex items-center gap-2">
                          <MrGoAvatar color={colorOf(a.key)} emotion="working" size={18} alive={false} />
                          <span className="w-16 shrink-0 truncate text-[11px] text-[#3a322a]">{a.nombre}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#ece5d8]">
                            <div className={`h-full rounded-full ${heat.cls}`} style={{ width: heat.w }} />
                          </div>
                          <span className="w-14 shrink-0 text-right text-[10px] text-[#857a66]">{heat.lbl}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Tira de equipo — una tarjeta por Mr Go: estado · motor · acción
              actual · progreso de la corrida · tira de crash. (Etapa 1) */}
          <section className="lg:col-span-10">
            <div className="rounded-xl border border-[#e7e0d2] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#4a4034]">
                  <Users className="h-4 w-4 text-[#7c3aed]" />
                  Tu equipo Mr Go
                </h2>
                <span className="text-xs text-[#a99d87]">
                  {(ceo ? 1 : 0) + equipo.length} agentes
                </span>
              </div>
              {/* Tira horizontal de agentes (scroll-x), estilo roster de MD */}
              <div className="flex gap-3 overflow-x-auto pb-2">
                {ceo && (
                  <div className="w-64 shrink-0">
                    <AgentCard
                      nombre={ceo.nombre}
                      rol="Director"
                      color={colorOf(ceo.key)}
                      engine={engineByKey.get(ceo.key)?.engine}
                      model={engineByKey.get(ceo.key)?.model}
                      activity={activity[ceo.key]}
                      director
                      paused={pausados.has(ceo.key)}
                      selected={seleccionado === ceo.key}
                      toolLabel={toolNombre}
                      onSelect={() => setSeleccionado((p) => (p === ceo.key ? null : ceo.key))}
                      onOrder={() => ordenarAAgente(ceo.key)}
                    />
                  </div>
                )}
                {equipo.map((a) => (
                  <div key={a.key} className="w-64 shrink-0">
                    <AgentCard
                      nombre={a.nombre}
                      rol={a.descripcion ? a.descripcion.split(/[,.]/)[0] : 'Agente'}
                      color={colorOf(a.key)}
                      engine={engineByKey.get(a.key)?.engine}
                      model={engineByKey.get(a.key)?.model}
                      activity={activity[a.key]}
                      paused={pausados.has(a.key)}
                      selected={seleccionado === a.key}
                      toolLabel={toolNombre}
                      onSelect={() => setSeleccionado((p) => (p === a.key ? null : a.key))}
                      onOrder={() => ordenarAAgente(a.key)}
                    />
                  </div>
                ))}
                {/* Agregar agente (los 14 roles se activan desde la config del equipo) */}
                <button
                  type="button"
                  onClick={() =>
                    toast({ type: 'info', message: 'Activá o pausá agentes desde la configuración del equipo.' })
                  }
                  className="flex w-40 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#ddd4c4] bg-[#faf7f0] p-5 text-[#857a66] transition-colors hover:border-[#e8692a] hover:text-[#e8692a]"
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-xs font-medium">Agregar agente</span>
                </button>
              </div>
            </div>
          </section>

          {/* ─── Giro del negocio ("bots por giro") ────────────────────────── */}
          <section className="lg:col-span-10">
            <div className="rounded-xl border border-[#e7e0d2] bg-white p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7c3aed]/10">
                    <Store className="h-4 w-4 text-[#7c3aed]" />
                  </span>
                  <div className="leading-tight">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-[#4a4034]">
                      Giro del negocio
                    </h2>
                    <p className="text-xs text-[#a99d87]">
                      Mr Go y sus agentes hablan en el tono de tu rubro
                    </p>
                  </div>
                </div>
                <a
                  href="/plantillas-negocio"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#857a66] transition-colors hover:text-[#e8692a]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Aplicar plantilla completa (servicios + bot)
                </a>
              </div>

              {giros.length === 0 ? (
                <p className="text-xs text-[#a99d87]">Cargando rubros…</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {giros.map((g) => {
                      const sel = giroId === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => elegirGiro(g.id)}
                          disabled={guardandoGiro}
                          title={g.descripcion}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                            sel
                              ? 'border-[#e8692a] bg-[#e8692a]/8 text-[#3a322a]'
                              : 'border-[#e7e0d2] bg-white text-[#857a66] hover:border-[#ddd4c4]'
                          }`}
                        >
                          <span aria-hidden>{g.icono}</span>
                          {g.nombre}
                          {sel && <Check className="h-3.5 w-3.5 text-[#e8692a]" strokeWidth={3} />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[11px] text-[#a99d87]">
                    {giroId
                      ? giros.find((g) => g.id === giroId)?.descripcion
                      : 'Elegí tu rubro para que Mr Go adopte su tono. Tocá el rubro activo de nuevo para quitarlo.'}
                  </p>
                </>
              )}
            </div>
          </section>

          {/* ─── Studio "Tu Mr Go" ─────────────────────────────────────────── */}
          <section className="lg:col-span-10">
            <div className="rounded-xl border border-[#e7e0d2] bg-white p-5">
              {/* Cabecera */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7c3aed]/10">
                    <Wand2 className="h-4 w-4 text-[#7c3aed]" />
                  </span>
                  <div className="leading-tight">
                    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#4a4034]">
                      Tu Mr Go
                      <span className="rounded-full bg-[#e8692a]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#e8692a]">
                        Nuevo
                      </span>
                    </h2>
                    <p className="text-xs text-[#a99d87]">Personalizá el avatar de cada agente</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={guardarStudio}
                  disabled={guardandoStudio}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#e8692a] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#d25e22] disabled:opacity-60"
                >
                  {guardandoStudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Guardar cambios
                </button>
              </div>

              {/* Selector de agente a personalizar */}
              <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
                {[...(ceo ? [ceo] : []), ...equipo].map((a) => {
                  const active = studioKey === a.key;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => setStudioKey(a.key)}
                      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-[#e8692a] bg-[#e8692a]/8 text-[#3a322a]'
                          : 'border-[#e7e0d2] bg-white text-[#857a66] hover:border-[#ddd4c4]'
                      }`}
                    >
                      <MrGoAvatar color={colorOf(a.key)} emotion="happy" size={20} alive={false} />
                      {a.nombre}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Columna izquierda — preview + nombre + rol */}
                <div className="lg:col-span-4">
                  <div className="relative flex items-end justify-center rounded-2xl border border-[#e7e0d2] bg-[#faf7f0] p-5" style={{ minHeight: 220 }}>
                    <span className="absolute left-3 top-3 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#857a66]">
                      {EMOTION_LABELS[studioEmotion]}
                    </span>
                    <MrGoAvatar
                      color={studioColor}
                      emotion={studioEmotion}
                      size={180}
                      pet={studioPet !== PET_NONE}
                      petKey={studioPet !== PET_NONE ? (studioPet as MrGoPetKey) : undefined}
                    />
                  </div>

                  <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wide text-[#857a66]">
                    Nombre del agente
                  </label>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#ddd4c4] bg-[#f6f2ea] px-3 py-2">
                    <input
                      type="text"
                      value={studioNombre}
                      onChange={(e) => setStudioNombre(e.target.value.slice(0, 40))}
                      placeholder={roleByKey.get(studioKey)?.nombre ?? studioKey}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#3a322a] placeholder:text-[#a99d87] focus:outline-none"
                    />
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-[#a99d87]" />
                  </div>

                  <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-[#857a66]">
                    Rol
                  </label>
                  <div className="mt-1 rounded-lg border border-[#e7e0d2] bg-white px-3 py-2 text-sm text-[#3a322a]">
                    {studioKey === CEO_AGENT_KEY ? 'Director' : roleByKey.get(studioKey)?.nombre ?? studioKey}
                  </div>
                </div>

                {/* Columna central — color + expresión + mascota */}
                <div className="lg:col-span-5 space-y-5">
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#4a4034]">
                      <Palette className="h-3.5 w-3.5 text-[#e8692a]" /> Color del cuerpo
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {MR_GO_COLOR_ORDER.map((k) => {
                        const sel = studioColor === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            title={MR_GO_COLORS[k].label}
                            onClick={() => setStudioColor(k)}
                            className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-transform hover:scale-105 ${
                              sel ? 'border-[#e8692a]' : 'border-transparent'
                            }`}
                            style={{ background: MR_GO_COLORS[k].hex }}
                          >
                            {sel && <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#4a4034]">
                      <Smile className="h-3.5 w-3.5 text-[#e8692a]" /> Expresión
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {STUDIO_EMOTIONS.map((e) => {
                        const sel = studioEmotion === e;
                        return (
                          <button
                            key={e}
                            type="button"
                            onClick={() => setStudioEmotion(e)}
                            className={`flex w-[72px] flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                              sel ? 'border-[#e8692a] bg-[#e8692a]/6' : 'border-[#e7e0d2] bg-white hover:border-[#ddd4c4]'
                            }`}
                          >
                            <MrGoAvatar color={studioColor} emotion={e} size={44} alive={false} />
                            <span className="text-[10px] text-[#857a66]">{EMOTION_LABELS[e]}</span>
                          </button>
                        );
                      })}
                    </div>
                    {studioColor !== 'LILA' && (
                      <p className="mt-1.5 text-[10px] text-[#a99d87]">
                        Las 6 expresiones se ven completas en el color insignia (Lila); en los demás se guarda la preferencia.
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#4a4034]">
                      <Heart className="h-3.5 w-3.5 text-[#e8692a]" /> Mascota
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {STUDIO_PETS.map((p) => {
                        const sel = studioPet === p;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setStudioPet(p)}
                            className={`flex w-[72px] flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                              sel ? 'border-[#e8692a] bg-[#e8692a]/6' : 'border-[#e7e0d2] bg-white hover:border-[#ddd4c4]'
                            }`}
                          >
                            <span className="flex h-11 items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/mrgo/pet/${p}.png`} alt="" draggable={false} style={{ height: 40, width: 'auto' }} />
                            </span>
                            <span className="text-[10px] text-[#857a66]">{MR_GO_PETS[p].nombre}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setStudioPet(PET_NONE)}
                        className={`flex w-[72px] flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                          studioPet === PET_NONE ? 'border-[#e8692a] bg-[#e8692a]/6' : 'border-[#e7e0d2] bg-white hover:border-[#ddd4c4]'
                        }`}
                      >
                        <span className="flex h-11 items-center justify-center text-[#c9bda6]">
                          <Trash2 className="h-6 w-6" />
                        </span>
                        <span className="text-[10px] text-[#857a66]">Ninguna</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Columna derecha — accesorios + familia + ficha técnica */}
                <div className="lg:col-span-3 space-y-5">
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#4a4034]">
                      <Shirt className="h-3.5 w-3.5 text-[#e8692a]" /> Accesorios
                      <span className="rounded bg-[#f0ead3] px-1.5 py-0.5 text-[9px] font-medium uppercase text-[#a99d87]">
                        Próximamente
                      </span>
                    </p>
                    <div className="flex items-center gap-2 opacity-60">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-[#ddd4c4] bg-[#faf7f0] text-[#c9bda6]">
                        <Shirt className="h-4 w-4" />
                      </span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-[#ddd4c4] bg-[#faf7f0] text-[#c9bda6]">
                        <Glasses className="h-4 w-4" />
                      </span>
                      <span className="text-[10px] text-[#a99d87]">0 disponibles</span>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#4a4034]">
                      <Users className="h-3.5 w-3.5 text-[#e8692a]" /> La familia Mr Go
                    </p>
                    <div className="grid grid-cols-7 gap-1">
                      {MR_GO_COLOR_ORDER.map((k) => (
                        <button
                          key={k}
                          type="button"
                          title={MR_GO_COLORS[k].label}
                          onClick={() => setStudioColor(k)}
                          className={`flex items-center justify-center rounded-md p-0.5 ${
                            studioColor === k ? 'ring-2 ring-[#e8692a]' : ''
                          }`}
                        >
                          <MrGoAvatar color={k} emotion="happy" size={26} alive={false} />
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-[#a99d87]">14 variantes de color · un Go base por agente</p>
                  </div>

                  <div className="rounded-lg border border-[#e7e0d2] bg-[#faf7f0] p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#857a66]">Ficha técnica</p>
                    <dl className="space-y-1 text-[11px]">
                      <div className="flex justify-between gap-2">
                        <dt className="text-[#a99d87]">Modelo</dt>
                        <dd className="font-medium text-[#3a322a]">Mr Go 3D</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[#a99d87]">Color actual</dt>
                        <dd className="flex items-center gap-1 font-medium text-[#3a322a]">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: MR_GO_COLORS[studioColor].hex }} />
                          {MR_GO_COLORS[studioColor].label}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[#a99d87]">Mascota</dt>
                        <dd className="font-medium text-[#3a322a]">
                          {studioPet === PET_NONE ? 'Ninguna' : MR_GO_PETS[studioPet as MrGoPetKey].nombre}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[#a99d87]">Expresiones</dt>
                        <dd className="font-medium text-[#3a322a]">6 disponibles</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[#a99d87]">Superaccesorios</dt>
                        <dd className="font-medium text-[#3a322a]">0 disponibles</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
