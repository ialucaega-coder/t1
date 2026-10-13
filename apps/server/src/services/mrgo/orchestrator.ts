/**
 * Mr Go — orquestador server-side ("cerebro GOD").
 *
 * Recibe un input del dueño/cliente y DECIDE qué agente-rol debería atenderlo y,
 * opcionalmente, qué tool/acción usar. Reusa el MOTOR DE IA MULTI-PROVEEDOR que
 * ya existe (`services/ai/engine` → `getAIProviderForBusiness` + el contrato
 * `AIProvider.generateResponse`): NO reescribe el motor, solo lo llama.
 *
 * ⚠️ Alcance v1: DEVUELVE la decisión (routing). NO ejecuta el tool todavía
 * (mismo criterio que workflows: interfaz lista, ejecución después). El cableado
 * real de los tools a sus endpoints es un paso posterior (ver TODO abajo).
 */
import { getAIProviderForBusiness } from '../ai/engine';
import {
  AGENT_CATALOG,
  TOOL_CATALOG,
  DEFAULT_AGENT_KEY,
  isValidToolKey,
  toolAllowedForAgent,
  loadAgents,
  type AgentConfig,
} from './agents';

/** Entrada del orquestador. */
export interface OrchestrateInput {
  businessId: string;
  /** El mensaje/input a rutear (del dueño o del cliente). */
  text: string;
  /** Canal de origen (ej: 'WEBCHAT', 'WHATSAPP', 'VOICE'). Opcional. */
  channel?: string;
}

/**
 * Decisión de routing que devuelve el orquestador. `tool`/`toolParams` son
 * opcionales: solo aparecen si Mr Go decidió que hace falta ejecutar un tool.
 */
export interface OrchestratorDecision {
  /** Clave del agente-rol que debería atender (del catálogo de agentes). */
  nextAgent: string;
  /** Estado emocional sugerido para el avatar (ej: 'neutral', 'entusiasmo'). */
  emotion: string;
  /** Por qué se eligió ese agente (texto breve del LLM). */
  reasoning: string;
  /** Tool propuesto (clave del catálogo de tools), si corresponde. */
  tool?: string;
  /** Parámetros sugeridos para el tool. v1 no los valida contra un schema. */
  toolParams?: Record<string, unknown>;
}

/** Emoción por defecto cuando el LLM no devuelve una válida. */
const DEFAULT_EMOTION = 'neutral';

/** Tope del input para no inflar el prompt con textos gigantes. */
const MAX_INPUT_LEN = 4000;

/**
 * Arma el prompt de sistema de routing con el catálogo de agentes ACTIVOS y el
 * catálogo de tools. Le pide al LLM responder SOLO un JSON con la decisión.
 */
function buildRoutingSystemPrompt(activeAgents: AgentConfig[]): string {
  const activeSet = new Set(activeAgents.map((a) => a.key));
  const agentLines = AGENT_CATALOG.filter((a) => activeSet.has(a.key))
    .map((a) => `- ${a.key}: ${a.nombre} — ${a.descripcion}`)
    .join('\n');
  const toolLines = TOOL_CATALOG.map((t) => `- ${t.key}: ${t.nombre} — ${t.descripcion}`).join('\n');

  return [
    'Sos Mr Go, un CEO virtual que coordina un equipo de agentes y DELEGA.',
    'Dado el mensaje del usuario, elegí qué agente lo atiende y explicá por qué.',
    'Si hace falta una acción concreta, proponé un tool del catálogo (y sus parámetros).',
    '',
    'AGENTES DISPONIBLES (elegí nextAgent de esta lista, por su clave):',
    agentLines,
    '',
    'TOOLS DISPONIBLES (tool opcional, por su clave; dejalo afuera si no hace falta):',
    toolLines,
    '',
    'Respondé SOLO un JSON válido, sin texto adicional, con esta forma exacta:',
    '{ "nextAgent": "<clave>", "emotion": "<estado>", "reasoning": "<breve>", "tool": "<clave|opcional>", "toolParams": { } }',
  ].join('\n');
}

/**
 * Extrae un objeto JSON de la respuesta del LLM de forma defensiva: intenta
 * `JSON.parse` directo y, si falla (el modelo rodeó el JSON de texto), recorta
 * desde la primera `{` hasta la última `}`. Devuelve null si no hay JSON usable.
 */
function extractJson(raw: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw.trim());
  if (direct) return direct;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) return tryParse(raw.slice(start, end + 1));
  return null;
}

/** Decisión de respaldo cuando el LLM falla o devuelve algo inusable. */
function fallbackDecision(activeAgents: AgentConfig[], motivo: string): OrchestratorDecision {
  // Preferimos el CEO (Mr Go) si está activo; si no, el primer agente activo.
  const ceoActive = activeAgents.some((a) => a.key === DEFAULT_AGENT_KEY);
  const nextAgent = ceoActive ? DEFAULT_AGENT_KEY : activeAgents[0]?.key ?? DEFAULT_AGENT_KEY;
  return {
    nextAgent,
    emotion: DEFAULT_EMOTION,
    reasoning: `Routing por defecto: ${motivo}.`,
  };
}

/**
 * Convierte el JSON crudo del LLM en una decisión tipada y saneada. Si el
 * `nextAgent` no es un agente ACTIVO, cae al fallback. Descarta un `tool` que
 * no esté en el catálogo (y sus params). Nunca lanza.
 */
function parseDecision(
  raw: Record<string, unknown>,
  activeAgents: AgentConfig[],
): OrchestratorDecision {
  const activeSet = new Set(activeAgents.map((a) => a.key));
  const nextAgent = typeof raw.nextAgent === 'string' && activeSet.has(raw.nextAgent)
    ? raw.nextAgent
    : null;
  if (!nextAgent) return fallbackDecision(activeAgents, 'el agente elegido no está activo o no vino');

  const emotion = typeof raw.emotion === 'string' && raw.emotion.trim()
    ? raw.emotion.trim().slice(0, 40)
    : DEFAULT_EMOTION;
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.trim().slice(0, 500) : '';

  const decision: OrchestratorDecision = { nextAgent, emotion, reasoning };

  // El tool es opcional: solo lo aceptamos si está en el catálogo Y el agente
  // elegido tiene permiso para usarlo (gating por rol estilo CrewAI). Así, por
  // ejemplo, Soporte no puede terminar generando un link de pago.
  if (isValidToolKey(raw.tool) && toolAllowedForAgent(nextAgent, raw.tool)) {
    decision.tool = raw.tool;
    if (raw.toolParams && typeof raw.toolParams === 'object' && !Array.isArray(raw.toolParams)) {
      decision.toolParams = raw.toolParams as Record<string, unknown>;
    }
  }

  return decision;
}

/**
 * Orquesta un input: decide qué agente lo atiende y qué tool proponer.
 *
 * Flujo: carga agentes activos → arma el prompt de routing → llama al motor de
 * IA del negocio → parsea el JSON de forma defensiva (con fallback). Si no hay
 * ningún agente activo o el motor falla, devuelve una decisión de respaldo.
 *
 * ⚠️ v1: NO ejecuta el tool. La decisión incluye `tool`/`toolParams` pero el
 * despacho real a los endpoints existentes se cablea después.
 * TODO(ejecución): mapear decision.tool → su endpoint del TOOL_CATALOG y
 * ejecutarlo con decision.toolParams (con auth/scope del negocio) cuando se
 * decida habilitar la ejecución real de tools.
 */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestratorDecision> {
  const { businessId, channel } = input;
  const text = (input.text ?? '').trim().slice(0, MAX_INPUT_LEN);

  const agents = await loadAgents(businessId);
  const activeAgents = agents.filter((a) => a.activo);
  if (activeAgents.length === 0) {
    return fallbackDecision(agents, 'no hay agentes activos configurados');
  }
  if (!text) {
    return fallbackDecision(activeAgents, 'el mensaje vino vacío');
  }

  const systemPrompt = buildRoutingSystemPrompt(activeAgents);
  const userPrompt = channel ? `[canal: ${channel}]\n${text}` : text;

  let rawResponse: string;
  try {
    const provider = await getAIProviderForBusiness(businessId);
    rawResponse = await provider.generateResponse(userPrompt, {
      businessId,
      history: [],
      systemPrompt,
    });
  } catch {
    // El motor de IA no está disponible (sin key/relay/default) o falló la
    // generación: degradamos a un routing por defecto en vez de romper.
    return fallbackDecision(activeAgents, 'el motor de IA no está disponible');
  }

  const json = extractJson(rawResponse);
  if (!json) return fallbackDecision(activeAgents, 'la respuesta del modelo no fue un JSON válido');

  return parseDecision(json, activeAgents);
}
