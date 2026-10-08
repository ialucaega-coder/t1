import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { loadIntegrationRequests, toggleIntegrationRequest } from '../services/integrations/requests';

const requestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  requested: z.boolean().default(true),
});

const router = Router();

// Lista de integraciones solicitadas por el negocio.
router.get(
  '/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const requested = await loadIntegrationRequests(req.auth!.businessId);
    res.json({ requested });
  })
);

// Marca/desmarca una integración como solicitada. Solo ADMIN.
router.post(
  '/requests',
  requireAuth,
  requireRole('ADMIN'),
  validate(requestSchema),
  asyncHandler(async (req, res) => {
    const { name, requested } = req.body as { name: string; requested: boolean };
    const list = await toggleIntegrationRequest(req.auth!.businessId, name, requested);
    res.json({ requested: list });
  })
);

export const integrationsRouter = router;
