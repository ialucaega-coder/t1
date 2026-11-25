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
import { enforceSpendCap, SpendCapError } from '../ai/spendCap';
import { recordAiSpend } from '../ai/usage';
import type { TokenUsage } from '../ai/provider';
import {
  AGENT_CATALOG,
  TOOL_CATALOG,
  DEFAULT_AGENT_KEY,
  isValidToolKey,
  toolAllowedForAgent,
  loadAgents,
  type AgentConfig,
} from './agents';
import { loadMemory, buildMemoryPrompt } from './memory';
import { loadIndustry, buildIndustryPrompt } from './industry';
import { loadOffice } from './office';
import { extractJson } from './json';

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
 * Claves de agentes en pausa (estado de la Oficina). Si la lectura falla no
 * rompemos el ruteo: sin dato asumimos que no hay pausas.
 */
async function loadPausedKeys(businessId: string): Promise<Set<string>> {
  try {
    const office = await loadOffice(businessId);
    return new Set(Array.isArray(office?.paused) ? office.paused : []);
  } catch {
    return new Set();
  }
}

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
  // elegido tiene permiso para usarlo (gating por rol estilo CrewAI, con el
  // override por agente del Studio). Así, por ejemplo, Soporte no puede terminar
  // generando un link de pago, ni un agente al que el dueño le apagó ese tool.
  const nextAgentCfg = activeAgents.find((a) => a.key === nextAgent);
  if (isValidToolKey(raw.tool) && toolAllowedForAgent(nextAgent, raw.tool, nextAgentCfg)) {
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

  // Lecturas independientes (agentes, giro, memoria y motor de IA): en paralelo la
  // latencia es la de la más lenta; antes eran 4 round-trips seriales a la DB.
  const providerPromise = getAIProviderForBusiness(businessId);
  providerPromise.catch(() => {}); // evita unhandledRejection si salimos antes del await
  const [agents, industry, memory, pausedKeys] = await Promise.all([
    loadAgents(businessId),
    loadIndustry(businessId),
    loadMemory(businessId),
    loadPausedKeys(businessId),
  ]);
  // Un agente pausado desde la Oficina NO recibe trabajo: se lo saca del catálogo
  // que ve el LLM y de los destinos válidos del parseo (igual que uno inactivo).
  const activeAgents = agents.filter((a) => a.activo && !pausedKeys.has(a.key));
  if (activeAgents.length === 0) {
    return fallbackDecision(agents, 'no hay agentes activos y sin pausa configurados');
  }
  if (!text) {
    return fallbackDecision(activeAgents, 'el mensaje vino vacío');
  }

  // Contexto del negocio: tono del giro elegido ("bots por giro") + memoria
  // (perfil + hechos). Ambos opcionales: si no hay nada, devuelven '' y no
  // afectan el prompt.
  const industria = buildIndustryPrompt(industry.giroId);
  const memoria = buildMemoryPrompt(memory);
  const contexto = [industria, memoria].filter(Boolean).join('\n\n');
  const routingPrompt = buildRoutingSystemPrompt(activeAgents);
  const systemPrompt = contexto ? `${contexto}\n\n${routingPrompt}` : routingPrompt;
  const userPrompt = channel ? `[canal: ${channel}]\n${text}` : text;

  let rawResponse: string;
  let usage: TokenUsage | undefined;
  try {
    const provider = await providerPromise;
    // getAIProviderForBusiness ya miró el tope al resolver el proveedor (cacheado);
    // se vuelve a chequear acá, justo antes de gastar, para que un proveedor en
    // caché no esquive el tope. SpendCapError cae en el fallback de abajo.
    await enforceSpendCap(businessId);
    rawResponse = await provider.generateResponse(userPrompt, {
      businessId,
      history: [],
      systemPrompt,
      recordUsage: (u) => { usage = u; },
    });
  } catch (err) {
    // El motor de IA no está disponible (sin key/relay/default), se alcanzó el tope
    // mensual de gasto o falló la generación: degradamos a un routing por defecto
    // en vez de romper.
    return fallbackDecision(
      activeAgents,
      err instanceof SpendCapError ? 'se alcanzó el tope mensual de gasto de IA' : 'el motor de IA no está disponible',
    );
  }

  // El gasto del ruteo cuenta para el tope mensual (libro de IA, fuente 'mrgo').
  if (usage) await recordAiSpend(businessId, usage, 'mrgo');

  const json = extractJson(rawResponse);
  if (!json) return fallbackDecision(activeAgents, 'la respuesta del modelo no fue un JSON válido');

  return parseDecision(json, activeAgents);
}
