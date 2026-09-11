import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

// Public endpoint — no auth required
router.get('/public', asyncHandler(async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { priceMonthly: 'asc' },
    select: {
      id: true,
      name: true,
      tier: true,
      priceMonthly: true,
      priceYearly: true,
      currency: true,
      maxBots: true,
      maxMessages: true,
      maxContacts: true,
      features: true,
    },
  });
  res.json(plans);
}));

export { router as plansRouter };
