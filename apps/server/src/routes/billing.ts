import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import {
  createCheckoutSession,
  createCustomerPortalSession,
  cancelSubscription,
  constructWebhookEvent,
  handleWebhookEvent,
} from '../services/stripe';

const subscribeSchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
});

const router = Router();

// ─── Webhook (no auth, raw body — registered before JSON middleware in index.ts) ───
router.post('/webhook', asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event;
  try {
    event = constructWebhookEvent(req.body as Buffer, signature);
  } catch (err) {
    res.status(400).json({ error: 'Webhook signature verification failed' });
    return;
  }

  await handleWebhookEvent(event);

  res.json({ received: true });
}));

// ─── Authenticated routes ──────────────────────────────────────────────────────
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
  if (!plan || !plan.isActive) {
    res.status(404).json({ error: 'Plan no encontrado' });
    return;
  }

  const existingSubscription = await prisma.subscription.findUnique({
    where: { businessId },
  });
  if (existingSubscription && existingSubscription.status !== 'CANCELLED') {
    res.status(409).json({ error: 'El negocio ya tiene una suscripción activa. Usá el portal de facturación para cambiar de plan.' });
    return;
  }

  // Check if business already has a Stripe customer ID
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  const checkoutUrl = await createCheckoutSession(
    businessId,
    planId,
    interval,
    business.stripeCustomerId ?? undefined,
  );

  res.json({ url: checkoutUrl });
}));

router.post('/portal', asyncHandler(async (req, res) => {
  const businessId = req.auth!.businessId;

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  if (!business.stripeCustomerId) {
    res.status(400).json({ error: 'No hay cliente de Stripe asociado. Suscribite primero.' });
    return;
  }

  const portalUrl = await createCustomerPortalSession(business.stripeCustomerId);

  res.json({ url: portalUrl });
}));

router.post('/cancel', asyncHandler(async (req, res) => {
  const businessId = req.auth!.businessId;

  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription) {
    res.status(404).json({ error: 'No hay suscripcion activa' });
    return;
  }

  if (!subscription.stripeSubscriptionId) {
    // Legacy subscription without Stripe — cancel locally only
    const updated = await prisma.subscription.update({
      where: { businessId },
      data: { cancelAtPeriodEnd: true },
      include: { plan: true },
    });
    res.json(updated);
    return;
  }

  await cancelSubscription(subscription.stripeSubscriptionId);

  const updated = await prisma.subscription.findUnique({
    where: { businessId },
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
