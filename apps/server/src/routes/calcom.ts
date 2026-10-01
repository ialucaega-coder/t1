/**
 * Rutas de la integración con Cal.com (agenda externa).
 *   GET  /status        → estado de conexión (sin exponer la API key)
 *   GET  /event-types   → lista de tipos de evento de la cuenta conectada
 *   POST /connect       → valida la API key y la guarda (cifrada) + eventTypeId
 *   POST /disconnect    → borra la conexión
 * Solo ADMIN puede conectar/desconectar.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getCalcomStatus, saveCalcomConfig, disconnectCalcom, loadCalcomConfig } from '../services/calcom/config';
import { testApiKey, listEventTypes } from '../services/calcom/client';

const router = Router();

const connectSchema = z.object({
  apiKey: z.string().min(1, 'La API key es obligatoria').trim(),
  eventTypeId: z.number().int().positive().optional(),
});

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getCalcomStatus(req.auth!.businessId));
  })
);

router.get(
  '/event-types',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cfg = await loadCalcomConfig(req.auth!.businessId);
    if (!cfg) throw new AppError(400, 'Conectá Cal.com primero');
    res.json({ eventTypes: await listEventTypes(cfg.apiKey) });
  })
);

router.post(
  '/connect',
  requireAuth,
  requireRole('ADMIN'),
  validate(connectSchema),
  asyncHandler(async (req, res) => {
    const { apiKey, eventTypeId } = req.body as z.infer<typeof connectSchema>;

    const valid = await testApiKey(apiKey);
    if (!valid) throw new AppError(400, 'La API key de Cal.com no es válida');

    const status = await saveCalcomConfig(req.auth!.businessId, {
      apiKey,
      eventTypeId: eventTypeId ?? null,
    });
    res.json(status);
  })
);

router.post(
  '/disconnect',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await disconnectCalcom(req.auth!.businessId);
    res.json({ connected: false, enabled: false, eventTypeId: null });
  })
);

export { router as calcomRouter };
