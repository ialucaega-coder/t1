/**
 * Rutas de la integración con Composio.
 *   GET  /status      → estado de conexión (sin exponer la API key)
 *   POST /connect     → valida la API key y la guarda (cifrada)
 *   POST /disconnect  → borra la conexión
 * Conectar/desconectar: solo ADMIN.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getCmpStatus, saveCmpConfig, disconnectCmp } from '../services/composio/config';
import { testApiKey } from '../services/composio/client';

const router = Router();

const connectSchema = z.object({
  apiKey: z.string().min(1, 'La API key es obligatoria').trim(),
});

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getCmpStatus(req.auth!.businessId));
  })
);

router.post(
  '/connect',
  requireAuth,
  requireRole('ADMIN'),
  validate(connectSchema),
  asyncHandler(async (req, res) => {
    const { apiKey } = req.body as z.infer<typeof connectSchema>;

    const valid = await testApiKey(apiKey);
    if (!valid) throw new AppError(400, 'La API key de Composio no es válida');

    const status = await saveCmpConfig(req.auth!.businessId, { apiKey });
    res.json(status);
  })
);

router.post(
  '/disconnect',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await disconnectCmp(req.auth!.businessId);
    res.json({ connected: false, enabled: false });
  })
);

export { router as composioRouter };
