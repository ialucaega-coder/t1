import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { loadBrandVoice, saveBrandVoice } from '../services/brand/config';
import { updateBrandVoiceSchema, UpdateBrandVoiceInput } from '../validators/brand';

const router = Router();

/** GET /api/brand — Devuelve la Voz de Marca del negocio autenticado. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const voice = await loadBrandVoice(req.auth!.businessId);
    res.json(voice);
  })
);

/** PUT /api/brand — Actualiza (merge parcial) la Voz de Marca. Solo ADMIN. */
router.put(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateBrandVoiceSchema),
  asyncHandler(async (req, res) => {
    const patch = req.body as UpdateBrandVoiceInput;
    const voice = await saveBrandVoice(req.auth!.businessId, patch);
    res.json(voice);
  })
);

export { router as brandRouter };
