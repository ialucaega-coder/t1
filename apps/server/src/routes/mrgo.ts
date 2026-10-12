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
import { requireAuth } from '../middleware/auth';
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

// Decide qué agente atiende un input (y qué tool proponer). No ejecuta el tool.
router.post(
  '/orchestrate',
  requireAuth,
  validate(orchestrateSchema),
  asyncHandler(async (req, res) => {
    const decision = await orchestrate({
      businessId: req.auth!.businessId,
      text: req.body.text,
      channel: req.body.channel,
    });
    res.json(decision);
  })
);

export const mrgoRouter = router;
