import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const subscribeSchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

router.get('/plans', asyncHandler(async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { priceMonthly: 'asc' },
  });
  res.json(plans);
}));

router.get('/subscription', asyncHandler(async (req, res) => {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId: req.auth!.businessId },
    include: { plan: true },
  });

  if (!subscription) {
    res.json(null);
    return;
  }

  res.json(subscription);
}));

router.post('/subscribe', validate(subscribeSchema), asyncHandler(async (req, res) => {
  const { planId, interval } = req.body;
  const businessId = req.auth!.businessId;

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    res.status(404).json({ error: 'Plan no encontrado' });
    return;
  }

  const existing = await prisma.subscription.findUnique({ where: { businessId } });

  const now = new Date();
  const periodEnd = new Date(now);
  if (interval === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  const amount = interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;

  if (existing) {
    const updated = await prisma.subscription.update({
      where: { businessId },
      data: {
        planId,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
      include: { plan: true },
    });

    await prisma.invoice.create({
      data: {
        number: `INV-${Date.now()}`,
        amount,
        currency: plan.currency,
        description: `${plan.name} - ${interval === 'yearly' ? 'Anual' : 'Mensual'}`,
        status: 'PAID',
        dueDate: now,
        paidAt: now,
        subscriptionId: updated.id,
        businessId,
      },
    });

    res.json(updated);
    return;
  }

  const subscription = await prisma.subscription.create({
    data: {
      planId,
      businessId,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    include: { plan: true },
  });

  await prisma.invoice.create({
    data: {
      number: `INV-${Date.now()}`,
      amount,
      currency: plan.currency,
      description: `${plan.name} - ${interval === 'yearly' ? 'Anual' : 'Mensual'}`,
      status: 'PAID',
      dueDate: now,
      paidAt: now,
      subscriptionId: subscription.id,
      businessId,
    },
  });

  res.json(subscription);
}));

router.post('/cancel', asyncHandler(async (req, res) => {
  const businessId = req.auth!.businessId;

  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription) {
    res.status(404).json({ error: 'No hay suscripción activa' });
    return;
  }

  const updated = await prisma.subscription.update({
    where: { businessId },
    data: { cancelAtPeriodEnd: true },
    include: { plan: true },
  });

  res.json(updated);
}));

router.get('/invoices', asyncHandler(async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { businessId: req.auth!.businessId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(invoices);
}));

export { router as billingRouter };
