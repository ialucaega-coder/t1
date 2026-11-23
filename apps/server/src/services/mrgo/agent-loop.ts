/**
 * Mr Go — loop agéntico (tool-calling real).
 *
 * El orquestador (`orchestrator.ts`) hace UN solo paso: elige un agente y, a lo
 * sumo, propone UN tool. Este módulo lo lleva al siguiente nivel: un BUCLE donde
 * el modelo llama una tool, VE el resultado real y decide el próximo paso, hasta
 * dar una respuesta final o agotar el tope de pasos. Así Mr Go resuelve pedidos
 * de varios pasos ("agendá un turno y mandale el recordatorio") ejecutando las
 * acciones reales del executor compartido.
 *
 * Diseño PROVIDER-AGNÓSTICO (sirve con los 14 motores): no usamos la API nativa
 * de tool-calling de cada proveedor, sino un protocolo JSON estilo ReAct sobre
 * el contrato de texto `AIProvider.generateResponse`. En cada turno el modelo
 * responde SOLO un JSON con una de dos formas:
 *   - { "action":"tool",  "tool":"<key>", "toolParams":{…}, "thought":"…" }
 *   - { "action":"final", "message":"…", "emotion":"…" }
 *
 * SEGURIDAD:
 *   - `dry_run` por defecto: las acciones externas se SIMULAN (no envían nada).
 *   - `live`: las acciones INTERNAS (mover CRM, crear cliente) se ejecutan, pero
 *     las EXTERNAS (link de pago, WhatsApp, campaña, reserva) PAUSAN el loop y
 *     devuelven `stoppedReason:'needs_confirmation'` con la acción propuesta, en
 *     vez de auto-ejecutarse a ciegas. La reanudación con confirmación es la
 *     Etapa 2 (el endpoint). El LLM nunca ve credenciales: propone, el server
 *     ejecuta con el scope del negocio.
 *   - Gating por rol (patrón CrewAI): el agente sólo puede usar los tools de su
 *     caja (`toolAllowedForAgent`). El `ceo` (Mr Go) coordina y puede todo.
 *   - Tope de pasos (`maxSteps`) para no iterar sin fin.
 *
 * Schema CONGELADO: no persiste nada acá (eso es Etapa 2+). Multi-tenant por
 * `businessId`.
 */
import type { ConversationTurn, TokenUsage } from '../ai/provider';
import { getAIProviderForBusiness } from '../ai/engine';
import { enforceSpendCap, SpendCapError } from '../ai/spendCap';
import { recordAiSpend } from '../ai/usage';
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
import { executeAction, actionKind, type ActionResult, type ActionKind, type ExecMode } from '../actions/executor';

/** Un paso ya EJECUTADO (o simulado) del loop: el tool, sus params y el resultado. */
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
  kind: ActionKind;
}

/** Por qué se detuvo el loop. */
export type StopReason =
  | 'final' // el modelo cerró con una respuesta
  | 'max_steps' // se alcanzó el tope de pasos sin cerrar
  | 'needs_confirmation' // una acción externa en live espera confirmación del dueño
  | 'no_engine' // no hay motor de IA disponible / falló la generación
  | 'empty'; // no vino instrucción

export interface AgentLoopResult {
  /** Agente-rol que corrió el loop (su caja de tools). */
  agent: string;
  /** Estado emocional sugerido para el avatar. */
  emotion: string;
  /** Pasos ejecutados/simulados, en orden. */
  steps: AgentStep[];
  /** Respuesta final para mostrarle al dueño (vacía si pausó por confirmación). */
  finalMessage: string;
  stoppedReason: StopReason;
  /** Presente sólo cuando `stoppedReason='needs_confirmation'`. */
  pending?: PendingAction;
  /** Si el CEO delegó en un especialista: en quién y por qué (lo setea la ruta). */
  delegation?: { agent: string; reasoning: string };
}

/** Proveedor de IA resuelto para el negocio (contrato texto→texto). */
type AIProvider = Awaited<ReturnType<typeof getAIProviderForBusiness>>;

export interface RunAgentLoopInput {
  businessId: string;
  /** La instrucción del dueño (o del cliente) a resolver. */
  text: string;
  channel?: string;
  /** Agente-rol que corre el loop. Default: el CEO (Mr Go), que puede todo. */
  agentKey?: string;
  /** dry_run (default): externas simuladas. live: externas piden confirmación. */
  mode?: ExecMode;
  /** Tope de pasos del loop. Default 5, techo duro 10. */
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 5;
const HARD_MAX_STEPS = 10;
const MAX_INPUT_LEN = 4000;

/**
 * Pistas de parámetros por tool (derivadas de lo que lee el executor). No es un
 * schema formal: le dice al modelo qué datos necesita cada acción para no
 * proponerla incompleta. Si falta algo, el executor devuelve 'omitido' y el
 * modelo lo corrige en el paso siguiente.
 */
const TOOL_PARAM_HINTS: Record<string, string> = {
  crear_reserva: 'serviceId, date (YYYY-MM-DD), startTime (HH:mm), professionalId, clientId',
  generar_link_pago: 'amount (número > 0), title/concepto',
  enviar_whatsapp: 'to (teléfono) o clientId, body (texto del mensaje)',
  mover_lifecycle: 'clientId, stage (NEW | HOT | PAYMENT | CUSTOMER)',
  lanzar_campana: 'campaignId',
  crear_cliente: 'name, email, phone (opcional)',
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Claves de agentes en pausa (estado de la Oficina). Un agente pausado no recibe
 * trabajo (igual que en el orquestador). Si la lectura falla, se asume sin pausas.
 */
async function loadPausedKeys(businessId: string): Promise<Set<string>> {
  try {
    const office = await loadOffice(businessId);
    return new Set(Array.isArray(office?.paused) ? office.paused : []);
  } catch {
    return new Set();
  }
}

/** Mensaje claro cuando se alcanzó el tope mensual de gasto de IA. */
function spendCapMessage(err: SpendCapError): string {
  return `Alcanzaste el tope mensual de gasto de IA (USD ${err.capUsd}). Mr Go deja de ejecutar hasta el mes que viene o hasta que subas el tope.`;
}

/** Elige el agente que corre el loop: el pedido, si es válido, está activo y no está
 *  en pausa; si no, el CEO (si está disponible); si no, el primer agente disponible. */
function pickAgent(agents: AgentConfig[], requested?: string, paused: ReadonlySet<string> = new Set()): string {
  const active = agents.filter((a) => a.activo && !paused.has(a.key));
  if (requested && active.some((a) => a.key === requested)) return requested;
  if (active.some((a) => a.key === DEFAULT_AGENT_KEY)) return DEFAULT_AGENT_KEY;
  return active[0]?.key ?? DEFAULT_AGENT_KEY;
}

/** Arma el prompt de sistema del loop: identidad del agente + tools permitidos
 *  (con sus params) + el protocolo JSON de dos formas + reglas de seguridad. */
function buildLoopSystemPrompt(
  agentKey: string,
  mode: ExecMode,
  memoria: string,
  config?: Pick<AgentConfig, 'tools'>,
): string {
  const role = AGENT_CATALOG.find((a) => a.key === agentKey);
  const roleName = role ? `${role.nombre} — ${role.descripcion}` : 'Mr Go (CEO)';

  // Tools efectivos del agente: los del rol, menos los que el dueño apagó en el
  // Studio (override por agente). El modelo solo ve y puede usar estos.
  const allowed = TOOL_CATALOG.filter((t) => toolAllowedForAgent(agentKey, t.key, config));
  const toolLines = allowed.length
    ? allowed
        .map((t) => `- ${t.key}: ${t.descripcion}. Parámetros: ${TOOL_PARAM_HINTS[t.key] ?? '(sin parámetros)'}`)
        .join('\n')
    : '(no tenés tools disponibles: resolvé sólo con una respuesta final)';

  const lines = [
    `Sos Mr Go operando como el agente "${roleName}". Resolvés el pedido del dueño del negocio ejecutando acciones concretas, paso a paso.`,
    '',
    'TOOLS DISPONIBLES (usá SOLO estas claves):',
    toolLines,
    '',
    'En CADA turno respondé SOLO un JSON válido (sin markdown ni texto alrededor) con UNA de estas dos formas:',
    '1) Para ejecutar una acción: {"action":"tool","tool":"<clave>","toolParams":{…},"thought":"<por qué, breve>"}',
    '2) Para terminar: {"action":"final","message":"<respuesta para el dueño>","emotion":"<estado, ej: entusiasmo>"}',
    '',
    'REGLAS:',
    '- Después de cada acción te voy a pasar su RESULTADO. Usalo para decidir el próximo paso.',
    '- No inventes datos (ids, montos, teléfonos). Si te falta un dato para una acción, terminá con action:"final" pidiéndoselo al dueño.',
    '- Si el resultado de una acción fue "omitido" por falta de datos, no la repitas igual: pedí el dato o probá otra cosa.',
    '- Cuando la tarea esté resuelta, terminá con action:"final".',
    mode === 'dry_run'
      ? '- Estás en modo PRUEBA: las acciones externas se simulan (no se envían de verdad).'
      : '- Estás en modo EN VIVO: las acciones externas (pagos, WhatsApp, campañas, reservas) requieren confirmación del dueño antes de ejecutarse.',
  ];
  return memoria ? `${memoria}\n\n${lines.join('\n')}` : lines.join('\n');
}

/** Formatea el resultado de una acción como observación para realimentar al modelo. */
function formatObservation(result: ActionResult): string {
  const datos = result.data ? ` · datos: ${JSON.stringify(result.data)}` : '';
  return [
    `RESULTADO de ${result.action}: [${result.status}] ${result.detail}${datos}.`,
    'Si la tarea quedó resuelta respondé action:"final"; si no, seguí con el próximo tool.',
  ].join(' ');
}

/** Contexto compartido del bucle (lo usan `runAgentLoop` y `resumeAgentLoop`). */
interface LoopContext {
  businessId: string;
  agent: string;
  /** Config del agente que corre (para el gating de tools con override del Studio). */
  agentConfig?: AgentConfig;
  emotion: string;
  mode: ExecMode;
  systemPrompt: string;
  provider: AIProvider;
  /** Historial ReAct acumulado (user/assistant) que ve el modelo. */
  turns: ConversationTurn[];
  /** Pasos ya ejecutados (se sigue empujando acá). */
  steps: AgentStep[];
}

/**
 * Núcleo del bucle: desde `firstPrompt`, pide al modelo el próximo paso, ejecuta
 * el tool (o pausa/termina) y realimenta, hasta `remaining` iteraciones. Lo
 * comparten la corrida nueva y la reanudación tras confirmar. Nunca lanza.
 */
async function continueLoop(ctx: LoopContext, firstPrompt: string, remaining: number): Promise<AgentLoopResult> {
  const { businessId, agent, agentConfig, emotion, mode, systemPrompt, provider, turns, steps } = ctx;
  let currentPrompt = firstPrompt;

  for (let i = 0; i < remaining; i++) {
    // El tope mensual de gasto se vuelve a chequear en CADA llamada al modelo (el
    // loop puede hacer hasta 10 seguidas y getAIProviderForBusiness solo lo mira
    // una vez al resolver el proveedor).
    try {
      await enforceSpendCap(businessId);
    } catch (err) {
      if (err instanceof SpendCapError) {
        return { agent, emotion, steps, finalMessage: spendCapMessage(err), stoppedReason: 'no_engine' };
      }
      // Cualquier otro error del chequeo es fail-open (igual que en el chatbot).
    }

    let raw: string;
    let usage: TokenUsage | undefined;
    try {
      raw = await provider.generateResponse(currentPrompt, {
        businessId,
        history: turns,
        systemPrompt,
        recordUsage: (u) => { usage = u; },
      });
    } catch (err) {
      const finalMessage = err instanceof SpendCapError ? spendCapMessage(err) : 'El motor de IA falló durante la ejecución.';
      return { agent, emotion, steps, finalMessage, stoppedReason: 'no_engine' };
    }
    // Gasto del loop al libro de IA (cuenta para el tope mensual). Nunca lanza.
    if (usage) await recordAiSpend(businessId, usage, 'mrgo');
    turns.push({ role: 'user', content: currentPrompt });
    turns.push({ role: 'assistant', content: raw });

    const json = extractJson(raw);
    if (!json) {
      currentPrompt = 'Tu respuesta no fue un JSON válido. Respondé SOLO el JSON con una de las dos formas indicadas.';
      continue;
    }

    // Acción: explícita, o inferida (si vino `tool` es tool; si no, final).
    const action = typeof json.action === 'string' ? json.action : (json.tool ? 'tool' : 'final');

    if (action === 'final') {
      const message = typeof json.message === 'string' ? json.message.trim() : '';
      const emo = typeof json.emotion === 'string' && json.emotion.trim() ? json.emotion.trim().slice(0, 40) : emotion;
      return { agent, emotion: emo, steps, finalMessage: message || 'Listo.', stoppedReason: 'final' };
    }

    // action === 'tool'
    const tool = typeof json.tool === 'string' ? json.tool : '';
    const params =
      json.toolParams && typeof json.toolParams === 'object' && !Array.isArray(json.toolParams)
        ? (json.toolParams as Record<string, unknown>)
        : {};
    const thought = typeof json.thought === 'string' ? json.thought.trim().slice(0, 500) : undefined;

    // Gating: el tool tiene que estar en el catálogo Y permitido para el agente
    // (rol + override del Studio).
    if (!isValidToolKey(tool) || !toolAllowedForAgent(agent, tool, agentConfig)) {
      currentPrompt = `El tool "${tool}" no está disponible para vos. Elegí uno de la lista o terminá con action:"final".`;
      continue;
    }

    // Seguridad: una acción EXTERNA en modo live pausa el loop para confirmación.
    const kind = actionKind(tool) ?? 'externo';
    if (mode === 'live' && kind === 'externo') {
      return {
        agent,
        emotion,
        steps,
        finalMessage: '',
        stoppedReason: 'needs_confirmation',
        pending: { tool, params, ...(thought ? { thought } : {}), kind },
      };
    }

    // Ejecutar (internas: real; externas en dry_run: simuladas) y realimentar.
    const result = await executeAction({ businessId, action: tool, params, mode });
    steps.push({ tool, params, ...(thought ? { thought } : {}), result });
    currentPrompt = formatObservation(result);
  }

  return {
    agent,
    emotion,
    steps,
    finalMessage: 'Alcancé el máximo de pasos sin cerrar la tarea. Revisá los pasos y, si hace falta, dame más datos.',
    stoppedReason: 'max_steps',
  };
}

/** Reconstruye el turno del asistente (el JSON ReAct) de un paso ya dado, para
 *  rearmar el historial al reanudar. No tiene que ser idéntico al original: le da
 *  al modelo el contexto de qué tool llamó y con qué params. */
function reconstructToolTurn(tool: string, params: Record<string, unknown>, thought?: string): string {
  return JSON.stringify({ action: 'tool', tool, toolParams: params, ...(thought ? { thought } : {}) });
}

/**
 * Corre el loop agéntico de Mr Go. Nunca lanza: ante un motor caído devuelve
 * `stoppedReason:'no_engine'` con los pasos hechos hasta ahí.
 */
export async function runAgentLoop(input: RunAgentLoopInput): Promise<AgentLoopResult> {
  const { businessId } = input;
  const text = (input.text ?? '').trim().slice(0, MAX_INPUT_LEN);
  const mode: ExecMode = input.mode ?? 'dry_run';
  const maxSteps = clamp(input.maxSteps ?? DEFAULT_MAX_STEPS, 1, HARD_MAX_STEPS);

  // Lecturas independientes en paralelo (agentes, giro, memoria y motor de IA):
  // antes eran 4 round-trips seriales a la DB en cada corrida.
  const providerPromise = getAIProviderForBusiness(businessId);
  providerPromise.catch(() => {}); // evita unhandledRejection si salimos antes del await
  const [agents, industry, memory, paused] = await Promise.all([
    loadAgents(businessId),
    loadIndustry(businessId),
    loadMemory(businessId),
    loadPausedKeys(businessId),
  ]);
  const agent = pickAgent(agents, input.agentKey, paused);
  const agentConfig = agents.find((a) => a.key === agent);
  const emotion = 'neutral';

  if (!text) {
    return { agent, emotion, steps: [], finalMessage: 'No recibí ninguna instrucción.', stoppedReason: 'empty' };
  }

  // Contexto del negocio: tono del giro ("bots por giro") + memoria. Ambos
  // opcionales (devuelven '' si no hay nada configurado).
  const industria = buildIndustryPrompt(industry.giroId);
  const memoria = buildMemoryPrompt(memory);
  const contexto = [industria, memoria].filter(Boolean).join('\n\n');
  const systemPrompt = buildLoopSystemPrompt(agent, mode, contexto, agentConfig);

  let provider: AIProvider;
  try {
    provider = await providerPromise;
  } catch (err) {
    return {
      agent,
      emotion,
      steps: [],
      finalMessage: err instanceof SpendCapError ? spendCapMessage(err) : 'El motor de IA no está disponible en este momento.',
      stoppedReason: 'no_engine',
    };
  }

  const turns: ConversationTurn[] = [];
  const firstPrompt = input.channel ? `[canal: ${input.channel}]\n${text}` : text;
  const steps: AgentStep[] = [];

  return continueLoop({ businessId, agent, agentConfig, emotion, mode, systemPrompt, provider, turns, steps }, firstPrompt, maxSteps);
}

/** Entrada para reanudar el loop tras confirmar una acción externa pendiente. */
export interface ResumeAgentLoopInput {
  businessId: string;
  /** La instrucción original del dueño (para reconstruir el contexto). */
  text: string;
  channel?: string;
  /** Agente-rol que venía corriendo el loop. */
  agentKey: string;
  /** Modo de ejecución; al reanudar siempre es 'live' (el dueño aprobó). */
  mode?: ExecMode;
  maxSteps?: number;
  /** Pasos ya ejecutados ANTES de la pausa (para rearmar el historial ReAct). */
  priorSteps?: AgentStep[];
  /** La acción pendiente que el dueño aprobó: se ejecuta en vivo y se continúa. */
  confirmed: { tool: string; params: Record<string, unknown>; thought?: string };
}

/**
 * Reanuda el loop DESPUÉS de que el dueño confirma una acción externa que había
 * quedado pendiente. Ejecuta esa acción EN VIVO (ya fue aprobada), reconstruye
 * el historial de la conversación a partir de los pasos previos y SIGUE la cadena
 * hasta cerrar, agotar pasos o volver a pausar en otra acción externa. Nunca
 * lanza. La reconstrucción del historial es stateless (schema congelado): el
 * cliente manda los pasos previos; sólo la acción confirmada se ejecuta de nuevo.
 */
export async function resumeAgentLoop(input: ResumeAgentLoopInput): Promise<AgentLoopResult> {
  const { businessId } = input;
  const text = (input.text ?? '').trim().slice(0, MAX_INPUT_LEN);
  const mode: ExecMode = input.mode ?? 'live';
  const maxSteps = clamp(input.maxSteps ?? DEFAULT_MAX_STEPS, 1, HARD_MAX_STEPS);

  const [agents, paused] = await Promise.all([loadAgents(businessId), loadPausedKeys(businessId)]);
  const agent = pickAgent(agents, input.agentKey, paused);
  const agentConfig = agents.find((a) => a.key === agent);
  const emotion = 'neutral';

  const confirmedTool = input.confirmed?.tool ?? '';
  // La acción a confirmar tiene que ser válida y permitida para el agente
  // (rol + override del Studio).
  if (!isValidToolKey(confirmedTool) || !toolAllowedForAgent(agent, confirmedTool, agentConfig)) {
    return { agent, emotion, steps: [], finalMessage: 'La acción a confirmar no es válida para este agente.', stoppedReason: 'final' };
  }
  const confirmedParams =
    input.confirmed.params && typeof input.confirmed.params === 'object' && !Array.isArray(input.confirmed.params)
      ? input.confirmed.params
      : {};
  const confirmedThought = input.confirmed.thought;

  // Las lecturas de contexto (giro, memoria, motor de IA) no dependen de la acción:
  // corren en paralelo con su ejecución en vez de esperar a que termine.
  const providerPromise = getAIProviderForBusiness(businessId);
  providerPromise.catch(() => {}); // evita unhandledRejection si salimos antes del await
  const contextReads = Promise.all([loadIndustry(businessId), loadMemory(businessId)]);
  contextReads.catch(() => {});

  // Ejecutar la acción confirmada EN VIVO (el dueño ya la aprobó explícitamente).
  const confirmedResult = await executeAction({ businessId, action: confirmedTool, params: confirmedParams, mode: 'live' });
  const prior = Array.isArray(input.priorSteps) ? input.priorSteps : [];
  const steps: AgentStep[] = [
    ...prior,
    { tool: confirmedTool, params: confirmedParams, ...(confirmedThought ? { thought: confirmedThought } : {}), result: confirmedResult },
  ];

  // Reconstruir el historial ReAct: pedido original → (tool → observación)× pasos
  // previos → la acción confirmada → su observación (= próximo prompt).
  const [industry, memory] = await contextReads;
  const industria = buildIndustryPrompt(industry.giroId);
  const memoria = buildMemoryPrompt(memory);
  const contexto = [industria, memoria].filter(Boolean).join('\n\n');
  const systemPrompt = buildLoopSystemPrompt(agent, mode, contexto, agentConfig);
  const initialUserPrompt = input.channel ? `[canal: ${input.channel}]\n${text}` : text;
  const turns: ConversationTurn[] = [{ role: 'user', content: initialUserPrompt }];
  for (const s of prior) {
    turns.push({ role: 'assistant', content: reconstructToolTurn(s.tool, s.params, s.thought) });
    turns.push({ role: 'user', content: formatObservation(s.result) });
  }
  turns.push({ role: 'assistant', content: reconstructToolTurn(confirmedTool, confirmedParams, confirmedThought) });
  const firstPrompt = formatObservation(confirmedResult);

  let provider: AIProvider;
  try {
    provider = await providerPromise;
  } catch (err) {
    // Sin motor (o con el tope de gasto alcanzado) no podemos continuar la cadena,
    // pero la acción confirmada YA se ejecutó: devolvemos ese resultado para que el
    // dueño lo vea.
    const capped = err instanceof SpendCapError;
    return {
      agent,
      emotion,
      steps,
      finalMessage: confirmedResult.ok
        ? `Ejecuté la acción confirmada. No pude continuar la cadena: ${capped ? spendCapMessage(err as SpendCapError) : 'el motor de IA no está disponible.'}`
        : `No se pudo ejecutar la acción: ${confirmedResult.detail}`,
      stoppedReason: 'no_engine',
    };
  }

  // Presupuesto restante: al menos 1 turno para que cierre, con techo duro.
  let remaining = maxSteps - steps.length;
  if (remaining < 1 && steps.length < HARD_MAX_STEPS) remaining = 1;
  remaining = clamp(remaining, 0, HARD_MAX_STEPS - steps.length);
  if (remaining === 0) {
    return { agent, emotion, steps, finalMessage: 'Ejecuté la acción confirmada. Alcancé el máximo de pasos.', stoppedReason: 'max_steps' };
  }

  return continueLoop({ businessId, agent, agentConfig, emotion, mode, systemPrompt, provider, turns, steps }, firstPrompt, remaining);
}
