import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import {
  loadWaTemplates,
  mutateWaTemplates,
  parseVariableCount,
  WA_TEMPLATE_NAME_RE,
  type WaTemplate,
  type WaTemplateButton,
  type WaTemplateCategory,
} from '../services/whatsapp/templates';

/**
 * API de Plantillas WhatsApp oficiales (HSM), montada en `/api/wa-templates`.
 *
 * Mismo gate que campañas (`requireAuth, requireCapability('marketing')`,
 * aplicado en index.ts). approve/reject exigen además rol ADMIN: representan la
 * decisión de Meta, simulada acá por el admin del negocio (en real llegaría por
 * webhook; eso queda fuera de alcance de esta feature).
 *
 * Todo scopeado por `businessId` del JWT. La persistencia vive en
 * Connection.config (schema congelado), ver services/whatsapp/templates.ts.
 */

const categoryEnum = z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']);

// Botón de plantilla. QUICK_REPLY no lleva value; URL/PHONE_NUMBER lo exigen.
const buttonSchema = z
  .object({
    type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
    text: z.string().min(1).max(25),
    value: z.string().max(2048).optional(),
  })
  .refine(
    (b) => b.type === 'QUICK_REPLY' || (typeof b.value === 'string' && b.value.trim().length > 0),
    { message: 'value es requerido para botones URL/PHONE_NUMBER', path: ['value'] },
  );

// Nombre: regla de Meta /^[a-z0-9_]{1,512}$/.
const nameSchema = z
  .string()
  .regex(WA_TEMPLATE_NAME_RE, 'El nombre debe ser minúsculas, dígitos y guión bajo (1..512 chars)');

const createSchema = z.object({
  name: nameSchema,
  language: z.string().min(2).max(10),
  category: categoryEnum,
  header: z.string().max(60).optional(),
  body: z.string().min(1).max(1024),
  footer: z.string().max(60).optional(),
  buttons: z.array(buttonSchema).max(3).optional(),
  example: z.array(z.string()).optional(),
});

// Parche parcial: todos los campos opcionales (no se tocan name/body si no vienen).
const patchSchema = z
  .object({
    name: nameSchema.optional(),
    language: z.string().min(2).max(10).optional(),
    category: categoryEnum.optional(),
    header: z.string().max(60).optional(),
    body: z.string().min(1).max(1024).optional(),
    footer: z.string().max(60).optional(),
    buttons: z.array(buttonSchema).max(3).optional(),
    example: z.array(z.string()).optional(),
  })
  .strict();

const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

/** Estados que permiten editar/re-enviar una plantilla. */
const EDITABLE: ReadonlySet<WaTemplate['status']> = new Set(['DRAFT', 'REJECTED']);

/** Busca una plantilla por id dentro de la lista o tira 404. */
function findOrThrow(templates: WaTemplate[], id: string): number {
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) throw new AppError(404, 'Plantilla no encontrada');
  return index;
}

/** Verifica que el name sea único en el negocio (case-insensitive), ignorando `selfId`. */
function assertNameUnique(templates: WaTemplate[], name: string, selfId?: string): void {
  const dup = templates.some(
    (t) => t.id !== selfId && t.name.toLowerCase() === name.toLowerCase(),
  );
  if (dup) throw new AppError(409, 'Ya existe una plantilla con ese nombre en el negocio');
}

const router = Router();

// Lista las plantillas del negocio (orden: updatedAt desc).
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const templates = await loadWaTemplates(req.auth!.businessId);
    res.json({ templates });
  }),
);

// Crea una plantilla en estado DRAFT (id + timestamps server-side).
router.post(
  '/',
  requireAuth,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    // Valida la numeración de variables del cuerpo antes de abrir la transacción.
    parseVariableCount(input.body);

    const now = new Date().toISOString();
    const created = await mutateWaTemplates(req.auth!.businessId, (templates) => {
      assertNameUnique(templates, input.name);
      const template: WaTemplate = {
        id: randomUUID(),
        name: input.name,
        language: input.language,
        category: input.category as WaTemplateCategory,
        status: 'DRAFT',
        body: input.body,
        createdAt: now,
        updatedAt: now,
        ...(input.header !== undefined ? { header: input.header } : {}),
        ...(input.footer !== undefined ? { footer: input.footer } : {}),
        ...(input.buttons !== undefined ? { buttons: input.buttons as WaTemplateButton[] } : {}),
        ...(input.example !== undefined ? { example: input.example } : {}),
      };
      return { templates: [...templates, template], result: template };
    });

    res.status(201).json(created);
  }),
);

// Edita una plantilla (sólo DRAFT|REJECTED). Si estaba REJECTED, limpia el motivo.
router.patch(
  '/:id',
  requireAuth,
  validate(patchSchema),
  asyncHandler(async (req, res) => {
    const patch = req.body as z.infer<typeof patchSchema>;
    const id = req.params.id as string;
    // Valida variables del cuerpo nuevo (si viene) antes de abrir la transacción.
    if (patch.body !== undefined) parseVariableCount(patch.body);

    const updated = await mutateWaTemplates(req.auth!.businessId, (templates) => {
      const index = findOrThrow(templates, id);
      const current = templates[index]!;
      if (!EDITABLE.has(current.status)) {
        throw new AppError(409, `No se puede editar una plantilla en estado ${current.status}`);
      }
      if (patch.name !== undefined) assertNameUnique(templates, patch.name, id);

      const next: WaTemplate = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.category !== undefined ? { category: patch.category as WaTemplateCategory } : {}),
        ...(patch.header !== undefined ? { header: patch.header } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.footer !== undefined ? { footer: patch.footer } : {}),
        ...(patch.buttons !== undefined ? { buttons: patch.buttons as WaTemplateButton[] } : {}),
        ...(patch.example !== undefined ? { example: patch.example } : {}),
        updatedAt: new Date().toISOString(),
      };
      // Editar una REJECTED la deja en REJECTED pero limpia el motivo de rechazo.
      if (current.status === 'REJECTED') delete next.rejectionReason;

      const list = [...templates];
      list[index] = next;
      return { templates: list, result: next };
    });

    res.json(updated);
  }),
);

// Envía a aprobación: DRAFT|REJECTED → PENDING. Valida que haya un ejemplo no
// vacío por cada variable del cuerpo (Meta los exige para aprobar).
router.post(
  '/:id/submit',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    const updated = await mutateWaTemplates(req.auth!.businessId, (templates) => {
      const index = findOrThrow(templates, id);
      const current = templates[index]!;
      if (!EDITABLE.has(current.status)) {
        throw new AppError(409, `No se puede enviar a aprobación una plantilla en estado ${current.status}`);
      }

      const nVars = parseVariableCount(current.body);
      const examples = current.example ?? [];
      const faltan =
        examples.length < nVars ||
        examples.slice(0, nVars).some((e) => typeof e !== 'string' || e.trim().length === 0);
      if (faltan) {
        throw new AppError(
          422,
          `Faltan ejemplos: la plantilla tiene ${nVars} variable(s) y necesita un ejemplo no vacío para cada una.`,
        );
      }

      const now = new Date().toISOString();
      const next: WaTemplate = {
        ...current,
        status: 'PENDING',
        submittedAt: now,
        updatedAt: now,
      };
      delete next.rejectionReason;

      const list = [...templates];
      list[index] = next;
      return { templates: list, result: next };
    });

    res.json(updated);
  }),
);

// Aprueba (simula la decisión de Meta): PENDING → APPROVED. Sólo ADMIN.
router.post(
  '/:id/approve',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'ADMIN') {
      throw new AppError(403, 'Sólo un administrador puede aprobar plantillas');
    }
    const id = req.params.id as string;

    const updated = await mutateWaTemplates(req.auth!.businessId, (templates) => {
      const index = findOrThrow(templates, id);
      const current = templates[index]!;
      if (current.status !== 'PENDING') {
        throw new AppError(409, `Sólo se puede aprobar una plantilla en estado PENDING (está ${current.status})`);
      }

      const now = new Date().toISOString();
      const next: WaTemplate = {
        ...current,
        status: 'APPROVED',
        reviewedAt: now,
        updatedAt: now,
      };
      delete next.rejectionReason;

      const list = [...templates];
      list[index] = next;
      return { templates: list, result: next };
    });

    res.json(updated);
  }),
);

// Rechaza (simula la decisión de Meta): PENDING → REJECTED con motivo. Sólo ADMIN.
router.post(
  '/:id/reject',
  requireAuth,
  validate(rejectSchema),
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'ADMIN') {
      throw new AppError(403, 'Sólo un administrador puede rechazar plantillas');
    }
    const id = req.params.id as string;
    const { reason } = req.body as z.infer<typeof rejectSchema>;

    const updated = await mutateWaTemplates(req.auth!.businessId, (templates) => {
      const index = findOrThrow(templates, id);
      const current = templates[index]!;
      if (current.status !== 'PENDING') {
        throw new AppError(409, `Sólo se puede rechazar una plantilla en estado PENDING (está ${current.status})`);
      }

      const now = new Date().toISOString();
      const next: WaTemplate = {
        ...current,
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedAt: now,
        updatedAt: now,
      };

      const list = [...templates];
      list[index] = next;
      return { templates: list, result: next };
    });

    res.json(updated);
  }),
);

// Elimina una plantilla (en cualquier estado).
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    await mutateWaTemplates(req.auth!.businessId, (templates) => {
      const next = templates.filter((t) => t.id !== id);
      if (next.length === templates.length) throw new AppError(404, 'Plantilla no encontrada');
      return { templates: next, result: undefined };
    });

    res.status(204).send();
  }),
);

export { router as waTemplatesRouter };
