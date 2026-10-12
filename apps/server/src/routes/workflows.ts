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

// Zod exige una tupla no vacía para z.enum; los catálogos nunca están vacíos.
const triggerEnum = z.enum(TRIGGER_KEYS as [string, ...string[]]);
const actionEnum = z.enum(ACTION_KEYS as [string, ...string[]]);

const createSchema = z.object({
  nombre: z.string().trim().min(1).max(MAX_NAME_LEN),
  trigger: triggerEnum,
  accion: actionEnum,
  condicion: z.string().trim().max(MAX_CONDITION_LEN).optional(),
  activo: z.boolean().optional(),
});

// En el PATCH todo es opcional (permite, por ejemplo, solo togglear `activo`).
const updateSchema = z
  .object({
    nombre: z.string().trim().min(1).max(MAX_NAME_LEN).optional(),
    trigger: triggerEnum.optional(),
    accion: actionEnum.optional(),
    condicion: z.string().trim().max(MAX_CONDITION_LEN).optional(),
    activo: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Se requiere al menos un campo para actualizar',
  });

// Dispara (o simula) las reglas de un trigger. `execute: true` las corre EN VIVO
// (acciones externas incluidas); por defecto hace dry-run (simula las externas).
const runSchema = z.object({
  trigger: triggerEnum,
  payload: z.record(z.unknown()).optional(),
  execute: z.boolean().optional(),
});

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
      actions: ACTION_CATALOG,
    });
  })
);

// Crea una regla nueva.
router.post(
  '/',
  requireAuth,
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

export const workflowsRouter = router;
