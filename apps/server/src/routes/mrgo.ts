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
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, requireStaff } from '../middleware/auth';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  AGENT_CATALOG,
  TOOL_CATALOG,
  TOOL_KEYS,
  ROLE_TOOLS,
  AGENT_KEYS,
  DEFAULT_AGENT_KEY,
  MAX_PROVIDER_LEN,
  MAX_MODEL_LEN,
  MAX_NAME_LEN,
  loadAgents,
  saveAgents,
  isValidToolKey,
  toolAllowedForAgent,
} from '../services/mrgo/agents';
import { orchestrate } from '../services/mrgo/orchestrator';
import { runAgentLoop, resumeAgentLoop, type AgentStep } from '../services/mrgo/agent-loop';
import { executeAction, actionKind } from '../services/actions/executor';
import { loadMemory, saveMemory, MAX_PROFILE_LEN, MAX_FACT_LEN, MAX_FACTS } from '../services/mrgo/memory';
import { loadOffice, saveOffice } from '../services/mrgo/office';
import { loadIndustry, saveIndustry } from '../services/mrgo/industry';
import { prisma } from '../lib/prisma';
import { IDEMP_TYPE_MRGO, readIdempotencyKey, claimIdempotentKey } from '../lib/idempotency';

/**
 * Garantía at-most-once para acciones EN VIVO. Si el cliente manda el header
 * `Idempotency-Key`, la clave se reserva antes de ejecutar: un reintento (timeout
 * del cliente, doble envío, proxy que reenvía) con la misma clave recibe 409 en
 * vez de repetir un WhatsApp, un cobro o una campaña. Sin header no cambia nada
 * (compatibilidad). Devuelve `false` si ya respondió 409 y la ruta debe cortar.
 */
async function claimLiveKey(req: Request, res: Response, businessId: string, scope: string): Promise<boolean> {
  const key = readIdempotencyKey(req.header('Idempotency-Key'));
  if (!key) return true;
  const claimed = await claimIdempotentKey(prisma, businessId, IDEMP_TYPE_MRGO, `${scope}:${key}`);
  if (claimed) return true;
  res.status(409).json({
    error: 'Esta orden ya fue recibida. Revisá el resultado antes de reenviarla.',
    code: 'DUPLICATE_REQUEST',
  });
  return false;
}

/**
 * `params`/`data` que llegan del cliente: acotados en cantidad de claves y en tamaño
 * serializado. Sin tope, un body gigante se reflejaba en el prompt del modelo (costo)
 * y en la base de datos.
 */
const MAX_PARAMS_KEYS = 20;
const MAX_PARAMS_BYTES = 8 * 1024;
const boundedRecord = z
  .record(z.string().max(60), z.unknown())
  .refine(
    (v) => Object.keys(v).length <= MAX_PARAMS_KEYS && JSON.stringify(v).length <= MAX_PARAMS_BYTES,
    { message: `Los parámetros son demasiado grandes (máx. ${MAX_PARAMS_KEYS} claves y 8 KB)` },
  );

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
  // Override de tools por agente (Studio). Se deja pasar como lista de strings y
  // el servicio (`sanitizeAgents`) valida contra el catálogo y el rol (no amplía).
  tools: z.array(z.string().trim().max(40)).max(TOOL_KEYS.length).optional(),
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
  params: boundedRecord.optional(),
  thought: z.string().max(500).optional(),
  result: z.object({
    action: z.string().max(60).optional(),
    kind: z.string().max(20).optional(),
    ok: z.boolean().optional(),
    status: z.string().max(20),
    detail: z.string().max(2000),
    data: boundedRecord.optional(),
  }),
});

const confirmSchema = z.object({
  tool: z.string().trim().min(1).max(60),
  params: boundedRecord.optional(),
  thought: z.string().trim().max(500).optional(),
  // Agente que confirma (opcional en el camino legacy): si viene, el tool tiene que
  // estar permitido para ESE agente; si no, para al menos un agente activo y sin pausa.
  agentKey: agentKeyEnum.optional(),
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

// Estado persistente de la oficina: pausas + posiciones del editor del piso.
// El servicio (`sanitizeOffice`) valida claves y recorta x/y a [0,100].
const officeSchema = z.object({
  paused: z.array(agentKeyEnum).max(AGENT_KEYS.length),
  positions: z
    .record(z.string(), z.object({ x: z.number(), y: z.number() }))
    .optional(),
});

// Giro del negocio ("bots por giro"). El id se valida contra el catálogo en el
// servicio; '' limpia el giro. Acá solo se limita la longitud (defensivo).
const industrySchema = z.object({
  giroId: z.string().trim().max(60),
});

const router = Router();

// Mr Go ejecuta acciones reales del negocio: solo staff (ADMIN / PROFESSIONAL). Un
// CLIENT con JWT no entra a nada de acá. (El montaje en index.ts además exige la
// capacidad 'bots'.)
router.use(requireAuth, requireStaff);

/**
 * Valida que un tool pueda confirmarse/ejecutarse: respeta el gating por rol y las
 * restricciones del Studio (`toolAllowedForAgent`) y NO usa agentes inactivos ni
 * pausados desde la Oficina. Lanza 403 si ningún agente elegible lo permite.
 */
async function assertToolConfirmable(businessId: string, tool: string, agentKey?: string): Promise<void> {
  const agents = await loadAgents(businessId);
  // Sin dato de la Oficina asumimos que no hay pausas (igual que el orquestador).
  let pausedKeys: string[] = [];
  try {
    const office = await loadOffice(businessId);
    if (Array.isArray(office?.paused)) pausedKeys = office.paused;
  } catch {
    pausedKeys = [];
  }
  const paused = new Set<string>(pausedKeys);
  const eligible = agents.filter((a) => a.activo && !paused.has(a.key) && (!agentKey || a.key === agentKey));
  if (eligible.length === 0) {
    throw new AppError(409, agentKey ? 'El agente está inactivo o en pausa: no puede ejecutar acciones.' : 'No hay agentes activos disponibles.');
  }
  if (!eligible.some((a) => toolAllowedForAgent(a.key, tool, a))) {
    throw new AppError(403, 'Ningún agente activo tiene permitido usar este tool (revisá el Studio).');
  }
}

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
      // Tools que CADA rol permite (fuente de verdad del gating): el Studio solo
      // deja RESTRINGIR dentro de esta lista por agente.
      roleTools: ROLE_TOOLS,
    });
  })
);

// Configura qué agentes están activos y su motor de IA opcional.
router.put(
  '/agents',
  requireAuth,
  requireRole('ADMIN'),
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
  tenantRateLimit({ name: 'mrgo-orchestrate', max: 30 }),
  validate(orchestrateSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    // Ejecutar en vivo es decisión del dueño: solo ADMIN.
    if (req.body.execute && req.auth!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo un administrador puede ejecutar acciones en vivo.' });
    }
    if (req.body.execute && !(await claimLiveKey(req, res, businessId, 'orchestrate'))) return;
    const decision = await orchestrate({
      businessId,
      text: req.body.text,
      channel: req.body.channel,
    });

    // Sin tool: solo ruteo.
    if (!decision.tool) return res.json({ ...decision, execution: null });

    const params = decision.toolParams ?? {};
    // `execute: true` + acción EXTERNA (WhatsApp, pago, campaña, reserva): NO se
    // ejecuta a ciegas; igual que /run, queda pendiente de confirmación (el dueño
    // la aprueba con POST /confirm). Las internas sí corren en vivo.
    if (req.body.execute && (actionKind(decision.tool) ?? 'externo') === 'externo') {
      return res.json({
        ...decision,
        execution: null,
        stoppedReason: 'needs_confirmation',
        pending: { tool: decision.tool, params, kind: 'externo' },
      });
    }

    // Por defecto dry_run: NADA se escribe ni se envía (ni las internas).
    const execution = await executeAction({
      businessId,
      action: decision.tool,
      params,
      mode: req.body.execute ? 'live' : 'dry_run',
    });

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
  tenantRateLimit({ name: 'mrgo-run', max: 12 }),
  validate(runSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { text, channel, maxSteps } = req.body as {
      text: string;
      channel?: string;
      maxSteps?: number;
    };
    const mode = req.body.execute ? 'live' : 'dry_run';
    if (mode === 'live' && !(await claimLiveKey(req, res, businessId, 'run'))) return;

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
  requireRole('ADMIN'),
  tenantRateLimit({ name: 'mrgo-confirm', max: 12 }),
  validate(confirmSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { tool, params, thought, resume, agentKey } = req.body as {
      tool: string;
      params?: Record<string, unknown>;
      thought?: string;
      agentKey?: string;
      resume?: {
        text: string;
        channel?: string;
        agentKey: string;
        steps?: AgentStep[];
        maxSteps?: number;
      };
    };
    if (!isValidToolKey(tool)) return res.status(400).json({ error: 'Tool desconocido' });
    // Gating en AMBOS caminos (con y sin `resume`): rol del agente + restricciones del
    // Studio + agentes inactivos/pausados. Antes el camino legacy ejecutaba cualquier
    // tool válido sin mirar nada de esto.
    await assertToolConfirmable(businessId, tool, resume?.agentKey ?? agentKey);
    // /confirm siempre ejecuta EN VIVO: la clave se reserva después de validar.
    if (!(await claimLiveKey(req, res, businessId, 'confirm'))) return;

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
// guarda cuando el dueño pausa/reactiva un agente. Solo ADMIN puede cambiarlo: la
// pausa decide qué agentes pueden ejecutar acciones (no es solo visual).
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
  requireRole('ADMIN'),
  validate(officeSchema),
  asyncHandler(async (req, res) => {
    res.json(await saveOffice(req.auth!.businessId, req.body));
  })
);

// Giro del negocio ("bots por giro"): Mr Go adopta el tono del rubro elegido al
// coordinar. Se carga al abrir la Oficina y se guarda al elegir un giro. Solo
// ADMIN (afecta el tono de TODOS los agentes). No crea servicios ni skills: eso
// es la plantilla completa (POST /api/plantillas-negocio/:id/aplicar), aparte.
router.get(
  '/industry',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await loadIndustry(req.auth!.businessId));
  })
);

router.put(
  '/industry',
  requireAuth,
  requireRole('ADMIN'),
  validate(industrySchema),
  asyncHandler(async (req, res) => {
    res.json(await saveIndustry(req.auth!.businessId, req.body));
  })
);

export const mrgoRouter = router;
