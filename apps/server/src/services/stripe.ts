import Stripe from 'stripe';
import { prisma } from '../lib/prisma';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('WARNING: STRIPE_SECRET_KEY not set. Stripe payments will not work.');
}

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new AppError(503, 'Pagos no configurados: falta STRIPE_SECRET_KEY');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

/** Maps Stripe subscription status strings to our Prisma enum. */
function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'CANCELLED';
    case 'trialing':
      return 'TRIALING';
    default:
      // 'incomplete' / 'paused' / cualquier estado futuro: nunca otorgar
      // acceso pago sin confirmación real del pago.
      return 'PAST_DUE';
  }
}

/**
 * Extracts period dates from a Stripe subscription.
 * In newer API versions, current_period_start/end live on subscription items.
 */
function extractPeriodDates(sub: Stripe.Subscription): { start: Date; end: Date } {
  const firstItem = sub.items.data[0];
  if (firstItem) {
    return {
      start: new Date(firstItem.current_period_start * 1000),
      end: new Date(firstItem.current_period_end * 1000),
    };
  }
  // Fallback: use billing_cycle_anchor as start, estimate end
  return {
    start: new Date(sub.billing_cycle_anchor * 1000),
    end: new Date(sub.billing_cycle_anchor * 1000),
  };
}

/**
 * Extracts the Stripe subscription ID from an Invoice's parent field.
 */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails) return null;

  return typeof subDetails.subscription === 'string'
    ? subDetails.subscription
    : subDetails.subscription?.id ?? null;
}

/**
 * Retrieves or creates a Stripe customer for the given business.
 * Stores the Stripe customer ID on the Business record for reuse.
 */
async function getOrCreateCustomer(businessId: string): Promise<string> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  if (business.stripeCustomerId) {
    return business.stripeCustomerId;
  }

  const customer = await getStripe().customers.create({
    metadata: { businessId },
    name: business.name,
    email: business.email ?? undefined,
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Creates a Stripe Checkout session for subscribing to a plan.
 * Returns the checkout session URL where the user should be redirected.
 */
export async function createCheckoutSession(
  businessId: string,
  planId: string,
  interval: 'monthly' | 'yearly',
  customerId?: string,
): Promise<string> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw new Error('Plan no encontrado');
  }

  const stripeCustomerId = customerId ?? await getOrCreateCustomer(businessId);

  const unitAmount = interval === 'yearly'
    ? Math.round(Number(plan.priceYearly) * 100)
    : Math.round(Number(plan.priceMonthly) * 100);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await getStripe().checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: plan.currency.toLowerCase(),
          product_data: {
            name: plan.name,
            description: `Plan ${plan.name} - ${interval === 'yearly' ? 'Anual' : 'Mensual'}`,
          },
          unit_amount: unitAmount,
          recurring: {
            interval: interval === 'yearly' ? 'year' : 'month',
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      businessId,
      planId,
      interval,
    },
    success_url: `${frontendUrl}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/dashboard/billing?cancelled=true`,
  });

  if (!session.url) {
    throw new Error('No se pudo crear la sesion de checkout');
  }

  return session.url;
}

/**
 * Crea un link de cobro de una sola vez ("Cobros por WhatsApp"): una URL de
 * Stripe Checkout en modo pago que el negocio le manda al cliente por chat.
 * Soporta montos e importes arbitrarios sin necesidad de crear productos.
 */
export async function createPaymentLink(
  businessId: string,
  params: { amount: number; description: string; currency?: string },
): Promise<string> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) {
    throw new AppError(404, 'Negocio no encontrado');
  }

  const currency = (params.currency || business.currency || 'usd').toLowerCase();
  const unitAmount = Math.round(params.amount * 100);
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
    throw new AppError(400, 'El monto del cobro debe ser mayor a 0');
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency,
          product_data: { name: params.description || `Cobro de ${business.name}` },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    metadata: { businessId, kind: 'payment_link' },
    success_url: `${frontendUrl}/cobros?paid=true`,
    cancel_url: `${frontendUrl}/cobros?cancelled=true`,
  });

  if (!session.url) {
    throw new AppError(502, 'No se pudo crear el link de cobro');
  }

  return session.url;
}

/**
 * Creates a Stripe Customer Portal session so the user can manage
 * their subscription, payment methods, and invoices directly.
 */
export async function createCustomerPortalSession(
  customerId: string,
): Promise<string> {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${frontendUrl}/dashboard/billing`,
  });

  return session.url;
}

/**
 * Syncs the local subscription record with the current state in Stripe.
 */
export async function syncSubscriptionStatus(
  stripeSubscriptionId: string,
): Promise<void> {
  const stripeSub = await getStripe().subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data'],
  });

  const period = extractPeriodDates(stripeSub);

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId },
    data: {
      status: mapStripeStatus(stripeSub.status),
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    },
  });
}

/**
 * Cancels a Stripe subscription at the end of the current billing period.
 */
export async function cancelSubscription(
  stripeSubscriptionId: string,
): Promise<void> {
  await getStripe().subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId },
    data: { cancelAtPeriodEnd: true },
  });
}

/**
 * Handles incoming Stripe webhook events and updates the database accordingly.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const { businessId, planId, interval } = session.metadata as {
        businessId: string;
        planId: string;
        interval: string;
      };

      if (!businessId || !planId) {
        console.error('Webhook checkout.session.completed: missing metadata', session.id);
        return;
      }

      const stripeSubscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

      if (!stripeSubscriptionId) {
        console.error('Webhook checkout.session.completed: no subscription ID', session.id);
        return;
      }

      const stripeSub = await getStripe().subscriptions.retrieve(stripeSubscriptionId, {
        expand: ['items.data'],
      });

      // Store Stripe customer ID on the business if not already set
      const stripeCustomerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

      if (stripeCustomerId) {
        await prisma.business.update({
          where: { id: businessId },
          data: { stripeCustomerId },
        });
      }

      const existingSub = await prisma.subscription.findUnique({
        where: { businessId },
      });

      const period = extractPeriodDates(stripeSub);

      const subData = {
        planId,
        status: mapStripeStatus(stripeSub.status),
        stripeSubscriptionId,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: false,
      };

      if (existingSub) {
        await prisma.subscription.update({
          where: { businessId },
          data: subData,
        });
      } else {
        await prisma.subscription.create({
          data: {
            ...subData,
            businessId,
          },
        });
      }

      console.log(`Subscription created/updated for business ${businessId}, plan ${planId}, interval ${interval}`);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);

      if (!stripeSubscriptionId) return;

      const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId },
        include: { plan: true },
      });

      if (!subscription) {
        console.warn(`Webhook invoice.paid: no local subscription for ${stripeSubscriptionId}`);
        return;
      }

      // Avoid duplicating invoices
      const existingInvoice = await prisma.invoice.findFirst({
        where: { stripeInvoiceId: invoice.id },
      });

      if (!existingInvoice) {
        await prisma.invoice.create({
          data: {
            number: invoice.number || `INV-${Date.now()}`,
            // Dividimos los centavos con Decimal (no float) para no arrastrar
            // imprecisión de punto flotante al pipeline de facturación.
            amount: new Prisma.Decimal(invoice.amount_paid ?? 0).div(100),
            currency: (invoice.currency ?? 'usd').toUpperCase(),
            description: `${subscription.plan.name} - Pago`,
            status: 'PAID',
            stripeInvoiceId: invoice.id,
            dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : new Date(),
            paidAt: new Date(),
            subscriptionId: subscription.id,
            businessId: subscription.businessId,
          },
        });
      }

      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionStatus(subscription.id);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: 'CANCELLED', cancelAtPeriodEnd: false },
      });
      break;
    }

    default:
      // Unhandled event type - ignore silently
      break;
  }
}

/**
 * Constructs and verifies a Stripe webhook event from the raw body and signature.
 */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  return getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
}
