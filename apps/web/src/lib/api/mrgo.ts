import { httpClient } from './http-client';
import type { MrGoColorKey, MrGoEmotion, MrGoPetKey } from '@/components/mrgo/types';

/**
 * Cliente API de Mr Go — el avatar/orquestador "CEO" que delega en agentes-rol.
 *
 * Reusa el `httpClient` como el resto de módulos (ver workflows.ts / clients.ts).
 * Los tipos de acá espejan el contrato del backend (apps/server/src/services/mrgo):
 * - `/agents` devuelve la config resuelta de agentes + catálogos de roles y tools.
 * - `/orchestrate` devuelve SOLO la decisión de routing (no ejecuta el tool en v1).
 */

/**
 * Config resuelta de UN agente del negocio. Es lo que devuelve el backend en
 * `agents` (no trae nombre/color/descripción: esos están en `roles`).
 */
export interface MrGoAgentConfig {
  key: string;
  activo: boolean;
  /** Familia de proveedor de IA opcional para este agente (ej: 'anthropic'). */
  llmProvider?: string;
  /** Modelo de IA opcional para este agente (ej: 'claude-3-5-sonnet'). */
  llmModel?: string;
  // ─── Personalización del avatar (Studio "Tu Mr Go") ───────────────────────
  /** Nombre personalizado; si falta, se usa el del catálogo de roles. */
  nombre?: string;
  /** Color del cuerpo elegido; si falta, el del rol (AGENT_COLOR_KEYS). */
  colorKey?: MrGoColorKey;
  /** Expresión en reposo elegida; si falta, la decide la UI. */
  emotion?: MrGoEmotion;
  /** Mascota elegida: una del catálogo o 'none' (sin mascota); si falta, la del rol. */
  pet?: MrGoPetKey | 'none';
}

/** Valor de `pet` que representa "sin mascota" (espeja PET_NONE del backend). */
export const PET_NONE = 'none' as const;

/**
 * Un rol del catálogo (datos de presentación para pintar la tarjeta). El `color`
 * que manda el backend es un hex de marca; para el avatar Mr Go usamos el mapa
 * `AGENT_COLOR_KEYS` de abajo (clave de agente → MrGoColorKey).
 */
export interface MrGoRole {
  key: string;
  nombre: string;
  color: string;
  descripcion: string;
}

/** Un tool que un agente podría proponer (mapea a un endpoint ya existente). */
export interface MrGoTool {
  key: string;
  nombre: string;
  descripcion: string;
  endpoint: string;
}

/** Respuesta de GET /agents: config del negocio + catálogos de roles y tools. */
export interface MrGoAgentsResponse {
  agents: MrGoAgentConfig[];
  roles: MrGoRole[];
  tools: MrGoTool[];
}

/**
 * Resultado de EJECUTAR (o simular) el tool que propuso Mr Go. Espeja el
 * `ActionResult` del backend (apps/server/src/services/mrgo).
 * - `kind`: 'interno' (mover etapa, notificar) vs 'externo' (enviar WhatsApp).
 * - `status`: 'ejecutado' (se efectuó), 'simulado' (externa sin execute),
 *   'no_soportado', 'omitido' o 'error'.
 */
export interface ActionResult {
  action: string;
  kind: 'interno' | 'externo';
  ok: boolean;
  status: 'ejecutado' | 'simulado' | 'no_soportado' | 'omitido' | 'error';
  detail: string;
  data?: Record<string, unknown>;
}

/**
 * Decisión de routing que devuelve POST /orchestrate. `emotion` viene como texto
 * libre del LLM (ej: 'neutral', 'entusiasmo'); el front lo mapea a MrGoEmotion.
 * `tool`/`toolParams` son opcionales (solo si Mr Go propuso una acción).
 * `execution` trae el resultado de ejecutar/simular ese tool (null si no hubo).
 */
export interface OrchestratorDecision {
  nextAgent: string;
  emotion: string;
  reasoning: string;
  tool?: string;
  toolParams?: Record<string, unknown>;
  execution: ActionResult | null;
}

/**
 * Mapa clave-de-agente → color de la familia Mr Go (para el avatar). El backend
 * manda un hex en `roles[].color`, pero MrGoAvatar necesita una MrGoColorKey. El
 * CEO es LILA (insignia). Las claves que no estén acá caen a LILA por defecto.
 */
export const AGENT_COLOR_KEYS: Record<string, MrGoColorKey> = {
  ceo: 'LILA',
  marketing: 'PINK',
  ventas: 'ORANGE',
  finanzas: 'GREEN',
  reservas: 'LIGHT_BLUE',
  cobros: 'YELLOW',
  soporte: 'RED',
  inbox: 'BLUE',
  crm: 'TURQUOISE',
  catalogo: 'LIME',
  campanas: 'BEIGE',
  analitica: 'BLACK',
  rrhh: 'BROWN',
  operaciones: 'WHITE',
};

/** Clave del CEO/Mr Go (el agente destacado y fallback del orquestador). */
export const CEO_AGENT_KEY = 'ceo';

/** Devuelve la MrGoColorKey de un agente (LILA por defecto si no está mapeado). */
export function colorKeyForAgent(key: string): MrGoColorKey {
  return AGENT_COLOR_KEYS[key] ?? 'LILA';
}

/**
 * Traduce la emoción de texto libre del orquestador a una MrGoEmotion válida
 * para el avatar. Defensivo: cualquier valor desconocido cae a 'thinking'.
 */
export function mapEmotion(raw: string | undefined | null): MrGoEmotion {
  const v = (raw ?? '').trim().toLowerCase();
  if (['happy', 'feliz', 'contento', 'alegre', 'entusiasmo', 'entusiasmado'].includes(v)) return 'happy';
  if (['working', 'trabajando', 'ocupado', 'activo'].includes(v)) return 'working';
  if (['thinking', 'pensando', 'neutral', 'analizando', 'duda'].includes(v)) return 'thinking';
  if (['nerd', 'tecnico', 'técnico'].includes(v)) return 'nerd';
  if (['angry', 'enojado', 'molesto', 'serio'].includes(v)) return 'angry';
  if (['sleepy', 'dormido', 'cansado', 'inactivo'].includes(v)) return 'sleepy';
  if (['love', 'amor', 'enamorado', 'encantado'].includes(v)) return 'love';
  return 'thinking';
}

/** Lista la config de agentes del negocio + catálogos de roles y tools. */
export function getMrGoAgents() {
  return httpClient.get<MrGoAgentsResponse>('/mrgo/agents');
}

/**
 * Le da una orden al equipo: el orquestador decide qué agente la atiende y, si
 * `execute` es true, EJECUTA el tool propuesto en vivo (acciones externas
 * reales). Por defecto no ejecuta en vivo: las acciones externas se simulan.
 */
export function orchestrate(text: string, channel?: string, execute = false) {
  return httpClient.post<OrchestratorDecision>('/mrgo/orchestrate', { text, channel, execute });
}

/** Persiste qué agentes están activos (y su motor de IA opcional). */
export function saveMrGoAgents(agents: MrGoAgentConfig[]) {
  return httpClient.put<{ agents: MrGoAgentConfig[] }>('/mrgo/agents', { agents });
}

// ─── Loop agéntico (tool-calling real) ───────────────────────────────────────

/** Un paso ya ejecutado (o simulado) del loop: el tool, sus params y el resultado. */
export interface AgentStep {
  tool: string;
  params: Record<string, unknown>;
  /** Razonamiento breve del modelo para ese paso (opcional). */
  thought?: string;
  result: ActionResult;
}

/** Acción propuesta que quedó PENDIENTE de confirmación (externa en modo live). */
export interface PendingAction {
  tool: string;
  params: Record<string, unknown>;
  thought?: string;
  kind: 'interno' | 'externo';
}

/** Por qué se detuvo el loop. */
export type StopReason = 'final' | 'max_steps' | 'needs_confirmation' | 'no_engine' | 'empty';

/** Resultado de POST /mrgo/run: la traza completa de la corrida del loop. */
export interface AgentLoopResult {
  /** Agente-rol que corrió el loop. */
  agent: string;
  emotion: string;
  steps: AgentStep[];
  finalMessage: string;
  stoppedReason: StopReason;
  /** Presente sólo cuando stoppedReason='needs_confirmation'. */
  pending?: PendingAction;
  /** Si el CEO delegó en un especialista: en quién y por qué. */
  delegation?: { agent: string; reasoning: string };
}

/**
 * Corre el loop agéntico: Mr Go encadena tools hasta resolver el pedido. Sin
 * `execute` va en dry_run (externas simuladas, vista previa); con execute=true va
 * en vivo y las acciones externas pausan esperando confirmación (ver confirmMrGo).
 */
export function runMrGo(text: string, channel?: string, execute = false, maxSteps?: number) {
  return httpClient.post<AgentLoopResult>('/mrgo/run', { text, channel, execute, maxSteps });
}

/**
 * Confirma y EJECUTA EN VIVO una acción sensible que el loop dejó pendiente
 * (link de pago, WhatsApp, etc.). Devuelve el resultado de la ejecución suelta.
 * Para que Mr Go SIGA la cadena después de confirmar, usá `resumeMrGo`.
 */
export function confirmMrGo(tool: string, params?: Record<string, unknown>) {
  return httpClient.post<ActionResult>('/mrgo/confirm', { tool, params });
}

/** Contexto para reanudar el loop tras confirmar (reconstruye el hilo ReAct). */
export interface ResumeContext {
  /** La orden original del dueño. */
  text: string;
  channel?: string;
  /** El agente que venía corriendo el loop. */
  agentKey: string;
  /** Los pasos ya ejecutados antes de la pausa. */
  steps: AgentStep[];
  maxSteps?: number;
}

/**
 * Confirma la acción pendiente y REANUDA la cadena: ejecuta la acción aprobada
 * EN VIVO y sigue el loop hasta cerrar o volver a pausar en otra acción externa.
 * Devuelve la traza completa actualizada (puede traer un nuevo `pending`).
 */
export function resumeMrGo(
  pending: { tool: string; params?: Record<string, unknown>; thought?: string },
  ctx: ResumeContext,
) {
  return httpClient.post<AgentLoopResult>('/mrgo/confirm', {
    tool: pending.tool,
    params: pending.params,
    thought: pending.thought,
    resume: {
      text: ctx.text,
      channel: ctx.channel,
      agentKey: ctx.agentKey,
      steps: ctx.steps,
      maxSteps: ctx.maxSteps,
    },
  });
}

/**
 * Memoria por negocio de Mr Go: `profile` (texto libre: qué es el negocio, tono,
 * reglas) + `facts` (hechos/notas recientes). Límites del backend: profile máx
 * 2000 chars; cada fact máx 300 chars; máx 50 facts.
 */
export interface MrGoMemory {
  profile: string;
  facts: string[];
}

/** Lee la memoria del negocio (profile + facts). */
export function getMrGoMemory() {
  return httpClient.get<MrGoMemory>('/mrgo/memory');
}

/** Guarda la memoria del negocio (solo ADMIN). Devuelve la memoria persistida. */
export function saveMrGoMemory(memory: { profile?: string; facts?: string[] }) {
  return httpClient.put<MrGoMemory>('/mrgo/memory', memory);
}

/**
 * Estado persistente de la oficina (el piso). Por ahora: qué agentes están EN
 * PAUSA (foco visual). El arreglo del piso es determinístico según los agentes
 * activos, así que no hace falta guardarlo aparte.
 */
export interface MrGoOffice {
  paused: string[];
}

/** Lee el estado de la oficina (pausas) del negocio. */
export function getMrGoOffice() {
  return httpClient.get<MrGoOffice>('/mrgo/office');
}

/** Persiste el estado de la oficina (pausas). Devuelve el estado guardado. */
export function saveMrGoOffice(office: MrGoOffice) {
  return httpClient.put<MrGoOffice>('/mrgo/office', office);
}

/**
 * Giro del negocio ("bots por giro"): el rubro elegido (id de las 14 plantillas
 * de INDUSTRY_TEMPLATES, o '' = sin giro). Mr Go adopta el TONO de ese rubro al
 * coordinar. No crea servicios/skills: eso es la plantilla completa (página
 * "Plantillas de negocio", `applyIndustryTemplate`).
 */
export interface MrGoIndustry {
  giroId: string;
}

/** Lee el giro elegido del negocio. */
export function getMrGoIndustry() {
  return httpClient.get<MrGoIndustry>('/mrgo/industry');
}

/** Guarda el giro del negocio (solo ADMIN). Devuelve el giro persistido. */
export function saveMrGoIndustry(giroId: string) {
  return httpClient.put<MrGoIndustry>('/mrgo/industry', { giroId });
}
