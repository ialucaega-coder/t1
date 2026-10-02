/**
 * Rutas de la integración con ManyChat.
 *   GET  /status      → estado de conexión (sin exponer la API key)
 *   POST /connect     → valida la API key y la guarda (cifrada)
 *   POST /disconnect  → borra la conexión
 * Conectar/desconectar: solo ADMIN.
 *
 * Nota: el webhook entrante bidireccional (ManyChat → nuestro bot → respuesta)
 * es un follow-up más profundo; esta primera iteración entrega el conector.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getMcStatus, saveMcConfig, disconnectMc } from '../services/manychat/config';
import { testApiKey } from '../services/manychat/client';

const router = Router();

const connectSchema = z.object({
  apiKey: z.string().min(1, 'La API key es obligatoria').trim(),
});

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getMcStatus(req.auth!.businessId));
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
    if (!valid) throw new AppError(400, 'La API key de ManyChat no es válida');

    const status = await saveMcConfig(req.auth!.businessId, { apiKey });
    res.json(status);
  })
);

router.post(
  '/disconnect',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await disconnectMc(req.auth!.businessId);
    res.json({ connected: false, enabled: false });
  })
);

export { router as manychatRouter };
