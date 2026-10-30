/**
 * Rutas de Mr Go — el orquestador/avatar que delega en agentes-rol.
 *
 * - GET  /agents      → agentes resueltos del negocio + catálogos (roles y tools)
 * - PUT  /agents      → configura qué agentes están activos y su motor opcional
 * - POST /orchestrate → decide qué agente atiende un input (y qué tool proponer)
 *
 * Scope multi-tenant: todo va con el businessId del auth (igual que
 * workflows.ts / team.ts). La EJECUCIÓN real de los tools no vive acá (ver
 * services/mrgo/orchestrator: `orchestrate` solo devuelve la decisión).
 *
 * NOTA DE MONTAJE (no se monta acá): en `apps/server/src/index.ts` agregar
 *   import { mrgoRouter } from './routes/mrgo';
 *   app.use('/api/mrgo', mrgoRouter);
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import {
  AGENT_CATALOG,
  TOOL_CATALOG,
  AGENT_KEYS,
  DEFAULT_AGENT_KEY,
  MAX_PROVIDER_LEN,
  MAX_MODEL_LEN,
  MAX_NAME_LEN,
  loadAgents,
  saveAgents,
  isValidToolKey,
} from '../services/mrgo/agents';
import { orchestrate } from '../services/mrgo/orchestrator';
import { runAgentLoop, resumeAgentLoop, type AgentStep } from '../services/mrgo/agent-loop';
import { executeAction } from '../services/actions/executor';
import { loadMemory, saveMemory, MAX_PROFILE_LEN, MAX_FACT_LEN, MAX_FACTS } from '../services/mrgo/memory';
import { loadOffice, saveOffice } from '../services/mrgo/office';

// Zod exige una tupla no vacía para z.enum; el catálogo nunca está vacío.
const agentKeyEnum = z.enum(AGENT_KEYS as [string, ...string[]]);

const agentConfigSchema = z.object({
  key: agentKeyEnum,
  activo: z.boolean().optional(),
  llmProvider: z.string().trim().max(MAX_PROVIDER_LEN).optional(),
  llmModel: z.string().trim().max(MAX_MODEL_LEN).optional(),
  // Personalización del avatar (Studio). Se dejan pasar como texto y el
  // servicio (`sanitizeAgents`) valida contra los catálogos de color/emoción/mascota.
  nombre: z.string().trim().max(MAX_NAME_LEN).optional(),
  colorKey: z.string().trim().max(20).optional(),
  emotion: z.string().trim().max(20).optional(),
  pet: z.string().trim().max(20).optional(),
});

const putAgentsSchema = z.object({
  agents: z.array(agentConfigSchema).max(AGENT_KEYS.length),
});

const orchestrateSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  channel: z.string().trim().max(40).optional(),
  // Si viene true y la decisión propone un tool, se EJECUTA (acciones externas
  // en vivo). Por defecto no ejecuta (o simula las externas): solo rutea.
  execute: z.boolean().optional(),
});

const runSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  channel: z.string().trim().max(40).optional(),
  // execute:true → el loop corre EN VIVO (y las acciones externas pausan
  // esperando confirmación). Por defecto dry_run (externas simuladas).
  execute: z.boolean().optional(),
  // Tope de pasos del loop (default 5 en el servicio; techo duro 10).
  maxSteps: z.number().int().min(1).max(10).optional(),
  // Delegación MANUAL opcional: forzar qué agente corre el loop. Si no viene, el
  // CEO rutea (orchestrate) y delega en el especialista que corresponda.
  agentKey: agentKeyEnum.optional(),
});

// Un paso previo del loop (lo manda el cliente al reanudar, para rearmar el
// contexto). El `result` es informativo: sólo se usa como texto de observación;
// la única acción que se EJECUTA al reanudar es la confirmada (validada aparte).
const stepSchema = z.object({
  tool: z.string().max(60),
  params: z.record(z.unknown()).optional(),
  thought: z.string().max(500).optional(),
  result: z.object({
    action: z.string().max(60).optional(),
    kind: z.string().max(20).optional(),
    ok: z.boolean().optional(),
    status: z.string().max(20),
    detail: z.string().max(2000),
    data: z.record(z.unknown()).optional(),
  }),
});

const confirmSchema = z.object({
  tool: z.string().trim().min(1).max(60),
  params: z.record(z.unknown()).optional(),
  thought: z.string().trim().max(500).optional(),
  // Si viene `resume`, tras ejecutar la acción confirmada se REANUDA la cadena
  // (puede volver a pausar). Sin `resume`, se ejecuta sólo esa acción (legacy).
  resume: z
    .object({
      text: z.string().trim().min(1).max(4000),
      channel: z.string().trim().max(40).optional(),
      agentKey: agentKeyEnum,
      steps: z.array(stepSchema).max(10).optional(),
      maxSteps: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
});

const memorySchema = z.object({
  profile: z.string().trim().max(MAX_PROFILE_LEN).optional(),
  facts: z.array(z.string().trim().max(MAX_FACT_LEN)).max(MAX_FACTS).optional(),
});

// Estado persistente de la oficina (qué agentes están en pausa).
const officeSchema = z.object({
  paused: z.array(agentKeyEnum).max(AGENT_KEYS.length),
});

const router = Router();

// Agentes resueltos del negocio + catálogos de roles y tools (para el panel).
router.get(
  '/agents',
  requireAuth,
  asyncHandler(async (req, res) => {
    const agents = await loadAgents(req.auth!.businessId);
    res.json({
      agents,
      roles: AGENT_CATALOG,
      tools: TOOL_CATALOG,
    });
  })
);

// Configura qué agentes están activos y su motor de IA opcional.
router.put(
  '/agents',
  requireAuth,
  validate(putAgentsSchema),
  asyncHandler(async (req, res) => {
    const agents = await saveAgents(req.auth!.businessId, req.body.agents);
    res.json({ agents });
  })
);

// Decide qué agente atiende un input y, si se pide `execute`, ejecuta el tool
// propuesto a través del executor compartido (mismo que Workflows). Sin
// `execute`, solo rutea: las acciones externas quedan en dry-run (simuladas).
router.post(
  '/orchestrate',
  requireAuth,
  validate(orchestrateSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const decision = await orchestrate({
      businessId,
      text: req.body.text,
      channel: req.body.channel,
    });

    // Si Mr Go decidió un tool, lo despachamos. `execute: true` → en vivo
    // (acciones externas reales); por defecto dry_run (externas simuladas).
    const execution = decision.tool
      ? await executeAction({
          businessId,
          action: decision.tool,
          params: decision.toolParams ?? {},
          mode: req.body.execute ? 'live' : 'dry_run',
        })
      : null;

    res.json({ ...decision, execution });
  })
);

// Loop agéntico (tool-calling real): Mr Go encadena tools hasta resolver el
// pedido o pausar. Sin `execute` corre en dry_run (externas simuladas, sirve de
// vista previa); con execute:true va en vivo y las acciones EXTERNAS pausan el
// loop (stoppedReason:'needs_confirmation' + pending) para que el dueño las
// confirme con POST /confirm. Devuelve la traza completa de pasos.
router.post(
  '/run',
  requireAuth,
  validate(runSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { text, channel, maxSteps } = req.body as {
      text: string;
      channel?: string;
      maxSteps?: number;
    };
    const mode = req.body.execute ? 'live' : 'dry_run';

    // Delegación: si el dueño no forzó un agente, el CEO rutea y elige al
    // especialista que atiende la orden; el loop corre COMO ese agente (con su
    // caja de tools). Así el loop deja de correr siempre como 'ceo'.
    let agentKey = req.body.agentKey as string | undefined;
    let delegation: { agent: string; reasoning: string } | undefined;
    if (!agentKey) {
      const decision = await orchestrate({ businessId, text, channel });
      agentKey = decision.nextAgent;
      if (agentKey !== DEFAULT_AGENT_KEY) {
        delegation = { agent: agentKey, reasoning: decision.reasoning };
      }
    }

    const result = await runAgentLoop({ businessId, text, channel, agentKey, mode, maxSteps });
    res.json(delegation ? { ...result, delegation } : result);
  })
);

// Confirma y EJECUTA EN VIVO una acción sensible que el loop dejó pendiente
// (link de pago, WhatsApp, campaña, reserva). El dueño aprueba explícitamente
// cada acción saliente: sin esto, el loop nunca manda nada al exterior solo.
router.post(
  '/confirm',
  requireAuth,
  validate(confirmSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { tool, params, thought, resume } = req.body as {
      tool: string;
      params?: Record<string, unknown>;
      thought?: string;
      resume?: {
        text: string;
        channel?: string;
        agentKey: string;
        steps?: AgentStep[];
        maxSteps?: number;
      };
    };
    if (!isValidToolKey(tool)) return res.status(400).json({ error: 'Tool desconocido' });

    // Con `resume`: ejecuta la acción confirmada EN VIVO y REANUDA la cadena
    // (devuelve la traza completa; puede volver a pausar en otra acción externa).
    if (resume) {
      const result = await resumeAgentLoop({
        businessId,
        text: resume.text,
        channel: resume.channel,
        agentKey: resume.agentKey,
        mode: 'live',
        maxSteps: resume.maxSteps,
        priorSteps: resume.steps,
        confirmed: { tool, params: params ?? {}, ...(thought ? { thought } : {}) },
      });
      return res.json(result);
    }

    // Sin `resume` (legacy): ejecuta sólo la acción confirmada.
    const result = await executeAction({ businessId, action: tool, params: params ?? {}, mode: 'live' });
    res.json(result);
  })
);

// Memoria del negocio (perfil + hechos) que el orquestador usa de contexto.
router.get(
  '/memory',
  requireAuth,
  asyncHandler(async (req, res) => {
    const memory = await loadMemory(req.auth!.businessId);
    res.json(memory);
  })
);

// Edita la memoria. Solo ADMIN (es config del negocio que guía a todos los agentes).
router.put(
  '/memory',
  requireAuth,
  requireRole('ADMIN'),
  validate(memorySchema),
  asyncHandler(async (req, res) => {
    const memory = await saveMemory(req.auth!.businessId, req.body);
    res.json(memory);
  })
);

// Estado persistente de la oficina (pausas). Se carga al abrir la Oficina y se
// guarda cuando el dueño pausa/reactiva un agente. Cualquier miembro del negocio
// puede cambiarlo (es foco visual del piso, no config sensible).
router.get(
  '/office',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await loadOffice(req.auth!.businessId));
  })
);

router.put(
  '/office',
  requireAuth,
  validate(officeSchema),
  asyncHandler(async (req, res) => {
    res.json(await saveOffice(req.auth!.businessId, req.body));
  })
);

export const mrgoRouter = router;
