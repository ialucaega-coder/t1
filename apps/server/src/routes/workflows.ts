/**
 * Rutas de Workflows / automatización (reglas trigger → condición → acción).
 *
 * CRUD de reglas por negocio + catálogos para la UI. Scope multi-tenant: todo
 * va con el businessId del auth (igual que team.ts / clients.ts). La ejecución
 * real de las reglas no vive acá (ver services/workflows: `evaluateWorkflows`).
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import {
  TRIGGER_CATALOG,
  ACTION_CATALOG,
  TRIGGER_KEYS,
  ACTION_KEYS,
  MAX_NAME_LEN,
  MAX_CONDITION_LEN,
  loadWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflows,
} from '../services/workflows';
import { isAutomationLive, setAutomationLive } from '../services/workflows/settings';
import { validateRuleParams, TEMPLATE_VARIABLES } from '../services/workflows/params';
import { patchSchema } from '../validators/patch';

// Zod exige una tupla no vacía para z.enum; los catálogos nunca están vacíos.
const triggerEnum = z.enum(TRIGGER_KEYS as [string, ...string[]]);
const actionEnum = z.enum(ACTION_KEYS as [string, ...string[]]);

// Parámetros de la acción (texto del mensaje, etapa, etc.): solo strings. La
// validación fina por acción (campos, largos, {{variables}}) la hace
// validateRuleParams, que es la misma que aplica el servicio al guardar.
const paramsSchema = z.record(z.string().max(100), z.string().max(2000));

const ruleShape = z.object({
  nombre: z.string().trim().min(1).max(MAX_NAME_LEN),
  trigger: triggerEnum,
  accion: actionEnum,
  condicion: z.string().trim().max(MAX_CONDITION_LEN).optional(),
  activo: z.boolean().optional(),
  params: paramsSchema.optional(),
});

const createSchema = ruleShape.superRefine((data, ctx) => {
  // Al crear, los params se validan contra la acción elegida (obligatorios incluidos).
  addParamIssues(ctx, data.accion, data.params);
});

// En el PATCH todo es opcional (permite, por ejemplo, solo togglear `activo`).
// Si el patch trae acción Y params se validan acá; si trae solo params, la acción
// de la regla guardada la conoce el servicio, que valida ahí (400).
const updateSchema = patchSchema(ruleShape)
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Se requiere al menos un campo para actualizar',
  })
  .superRefine((data, ctx) => {
    if (data.accion !== undefined && data.params !== undefined) {
      addParamIssues(ctx, data.accion, data.params);
    }
  });

function addParamIssues(ctx: z.RefinementCtx, accion: string, params: unknown) {
  const res = validateRuleParams(accion, params);
  if (res.ok) return;
  for (const issue of res.issues) {
    ctx.addIssue({ code: 'custom', path: issue.field.split('.'), message: issue.message });
  }
}

// Dispara (o simula) las reglas de un trigger. `execute: true` las corre EN VIVO
// (acciones externas incluidas); por defecto hace dry-run (simula las externas).
const runSchema = z.object({
  trigger: triggerEnum,
  payload: z.record(z.string(), z.unknown()).optional(),
  execute: z.boolean().optional(),
});

const settingsSchema = z.object({ live: z.boolean() });

const router = Router();

// Lista de reglas del negocio + catálogos de triggers y acciones (para la UI).
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rules = await loadWorkflows(req.auth!.businessId);
    res.json({
      rules,
      triggers: TRIGGER_CATALOG,
      actions: ACTION_CATALOG, // cada acción trae `params`: los campos que la UI debe pedir
      variables: TEMPLATE_VARIABLES, // {{variables}} disponibles en los textos
    });
  })
);

// Crea una regla nueva. Solo ADMIN: el contenido de la regla (ej: el texto del
// WhatsApp) sale hacia los clientes cuando la ejecución está en vivo.
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const rule = await createWorkflow(req.auth!.businessId, req.body);
    if (!rule) return res.status(400).json({ error: 'No se pudo crear la regla (datos inválidos o límite alcanzado)' });
    res.status(201).json(rule);
  })
);

// Edita una regla por id (incluye activar/desactivar con `activo`).
router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const rule = await updateWorkflow(req.auth!.businessId, req.params.id as string, req.body);
    if (!rule) return res.status(404).json({ error: 'Regla no encontrada' });
    res.json(rule);
  })
);

// Borra una regla por id.
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const ok = await deleteWorkflow(req.auth!.businessId, req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'Regla no encontrada' });
    res.status(204).send();
  })
);

// Dispara las reglas de un trigger y devuelve qué hizo cada acción. Solo ADMIN,
// porque en modo `execute` produce efectos reales (ej: enviar WhatsApp).
router.post(
  '/run',
  requireAuth,
  requireRole('ADMIN'),
  validate(runSchema),
  asyncHandler(async (req, res) => {
    const { trigger, payload, execute } = req.body as {
      trigger: string;
      payload?: Record<string, unknown>;
      execute?: boolean;
    };
    const run = await runWorkflows(
      req.auth!.businessId,
      { trigger, payload },
      execute ? 'live' : 'dry_run',
    );
    res.json({ trigger, mode: execute ? 'live' : 'dry_run', ...run });
  })
);

// Ajuste del negocio: ¿los disparos AUTOMÁTICOS del pipeline corren en vivo?
router.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const live = await isAutomationLive(req.auth!.businessId);
    res.json({ live });
  })
);

// Activa/desactiva la ejecución en vivo de las automatizaciones automáticas.
// Solo ADMIN: en vivo produce efectos salientes reales (ej: enviar WhatsApp).
router.put(
  '/settings',
  requireAuth,
  requireRole('ADMIN'),
  validate(settingsSchema),
  asyncHandler(async (req, res) => {
    const live = await setAutomationLive(req.auth!.businessId, req.body.live === true);
    res.json({ live });
  })
);

export const workflowsRouter = router;
