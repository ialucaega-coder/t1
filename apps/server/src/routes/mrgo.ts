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
  MAX_PROVIDER_LEN,
  MAX_MODEL_LEN,
  loadAgents,
  saveAgents,
} from '../services/mrgo/agents';
import { orchestrate } from '../services/mrgo/orchestrator';
import { executeAction } from '../services/actions/executor';
import { loadMemory, saveMemory, MAX_PROFILE_LEN, MAX_FACT_LEN, MAX_FACTS } from '../services/mrgo/memory';

// Zod exige una tupla no vacía para z.enum; el catálogo nunca está vacío.
const agentKeyEnum = z.enum(AGENT_KEYS as [string, ...string[]]);

const agentConfigSchema = z.object({
  key: agentKeyEnum,
  activo: z.boolean().optional(),
  llmProvider: z.string().trim().max(MAX_PROVIDER_LEN).optional(),
  llmModel: z.string().trim().max(MAX_MODEL_LEN).optional(),
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

const memorySchema = z.object({
  profile: z.string().trim().max(MAX_PROFILE_LEN).optional(),
  facts: z.array(z.string().trim().max(MAX_FACT_LEN)).max(MAX_FACTS).optional(),
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

export const mrgoRouter = router;
