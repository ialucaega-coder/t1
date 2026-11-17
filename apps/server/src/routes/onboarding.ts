/**
 * Endpoints del checklist de puesta en marcha (onboarding).
 *
 * GET  /api/onboarding          → checklist calculado desde el estado real.
 * PUT  /api/onboarding/dismiss  → oculta/muestra el checklist ({ dismissed }).
 *
 * El montaje en index.ts aplica requireAuth (es info del propio negocio; no
 * requiere una capability específica porque es transversal al panel).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { buildOnboarding, setDismissed } from '../services/onboarding/checklist';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const onboarding = await buildOnboarding(req.auth!.businessId);
    res.json(onboarding);
  })
);

const dismissSchema = z.object({ dismissed: z.boolean() });

router.put(
  '/dismiss',
  validate(dismissSchema),
  asyncHandler(async (req, res) => {
    await setDismissed(req.auth!.businessId, req.body.dismissed);
    const onboarding = await buildOnboarding(req.auth!.businessId);
    res.json(onboarding);
  })
);

export { router as onboardingRouter };
