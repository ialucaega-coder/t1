/**
 * Pruebas del servicio de Stripe (services/stripe.ts): la ruta de dinero.
 *
 * Cubre el manejo de webhooks (`handleWebhookEvent`) —crear/actualizar la
 * suscripción al completarse el checkout, registrar la factura al pagarse
 * (con deduplicación), sincronizar y cancelar suscripciones—, la validación
 * del monto de los links de cobro y la verificación de firma del webhook.
 *
 * El SDK de Stripe se mockea con una instancia estable (via vi.hoisted) para
 * poder afirmar contra sus métodos. Prisma también se mockea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

const { stripeInstance } = vi.hoisted(() => ({
  stripeInstance: {
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    customers: { create: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
}));

vi.mock('stripe', () => ({ default: vi.fn(() => stripeInstance) }));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn() },
    subscription: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    invoice: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  handleWebhookEvent,
  constructWebhookEvent,
  createPaymentLink,
} from '../../services/stripe';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Fabrica una suscripción de Stripe mínima con las fechas de período en el item. */
function fakeSub(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_123',
    status: 'active',
    cancel_at_period_end: false,
    billing_cycle_anchor: 1_700_000_000,
    items: {
      data: [
        {
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('services/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  });

  describe('handleWebhookEvent — checkout.session.completed', () => {
    const baseSession = {
      id: 'cs_1',
      metadata: { businessId: 'biz_1', planId: 'plan_1', interval: 'monthly' },
      subscription: 'sub_123',
      customer: 'cus_123',
    } as unknown as Stripe.Checkout.Session;

    it('crea la suscripción local cuando no existía y guarda el customer', async () => {
      mock(stripeInstance.subscriptions.retrieve).mockResolvedValue(fakeSub());
      mock(prisma.subscription.findUnique).mockResolvedValue(null);

      await handleWebhookEvent({
        type: 'checkout.session.completed',
        data: { object: baseSession },
      } as unknown as Stripe.Event);

      expect(prisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'biz_1' }, data: { stripeCustomerId: 'cus_123' } })
      );
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz_1',
            planId: 'plan_1',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_123',
          }),
        })
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('actualiza la suscripción existente en vez de crear otra', async () => {
      mock(stripeInstance.subscriptions.retrieve).mockResolvedValue(fakeSub());
      mock(prisma.subscription.findUnique).mockResolvedValue({ id: 's1', businessId: 'biz_1' });

      await handleWebhookEvent({
        type: 'checkout.session.completed',
        data: { object: baseSession },
      } as unknown as Stripe.Event);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('ignora el evento (sin tocar la DB) si falta metadata obligatoria', async () => {
      await handleWebhookEvent({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_2', metadata: {} } },
      } as unknown as Stripe.Event);

      expect(stripeInstance.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('no otorga acceso pago cuando la suscripción quedó en estado "incomplete"', async () => {
      mock(stripeInstance.subscriptions.retrieve).mockResolvedValue(
        fakeSub({ status: 'incomplete' as Stripe.Subscription.Status })
      );
      mock(prisma.subscription.findUnique).mockResolvedValue(null);

      await handleWebhookEvent({
        type: 'checkout.session.completed',
        data: { object: baseSession },
      } as unknown as Stripe.Event);

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAST_DUE' }) })
      );
    });
  });

  describe('handleWebhookEvent — invoice.paid', () => {
    const invoiceEvent = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          number: 'A-0001',
          amount_paid: 2990,
          currency: 'usd',
          due_date: 1_700_000_000,
          parent: { subscription_details: { subscription: 'sub_123' } },
        },
      },
    } as unknown as Stripe.Event;

    it('crea la factura y divide los centavos con Decimal', async () => {
      mock(prisma.subscription.findFirst).mockResolvedValue({
        id: 's1',
        businessId: 'biz_1',
        plan: { name: 'Pro' },
      });
      mock(prisma.invoice.findFirst).mockResolvedValue(null);

      await handleWebhookEvent(invoiceEvent);

      expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
      const arg = mock(prisma.invoice.create).mock.calls[0][0] as { data: { amount: unknown; currency: string; status: string } };
      expect(Number(arg.data.amount)).toBe(29.9);
      expect(arg.data.currency).toBe('USD');
      expect(arg.data.status).toBe('PAID');
    });

    it('no duplica la factura si ya existe una con el mismo stripeInvoiceId', async () => {
      mock(prisma.subscription.findFirst).mockResolvedValue({
        id: 's1',
        businessId: 'biz_1',
        plan: { name: 'Pro' },
      });
      mock(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv_existing' });

      await handleWebhookEvent(invoiceEvent);

      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('ignora el evento si no hay suscripción local para ese subscription id', async () => {
      mock(prisma.subscription.findFirst).mockResolvedValue(null);

      await handleWebhookEvent(invoiceEvent);

      expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('ignora el evento si la factura no tiene subscription en el parent', async () => {
      await handleWebhookEvent({
        type: 'invoice.paid',
        data: { object: { id: 'in_2', amount_paid: 100, parent: null } },
      } as unknown as Stripe.Event);

      expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookEvent — ciclo de vida de la suscripción', () => {
    it('customer.subscription.updated sincroniza estado y período', async () => {
      mock(stripeInstance.subscriptions.retrieve).mockResolvedValue(fakeSub({ status: 'past_due' }));

      await handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_123' } },
      } as unknown as Stripe.Event);

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeSubscriptionId: 'sub_123' },
          data: expect.objectContaining({ status: 'PAST_DUE' }),
        })
      );
    });

    it('customer.subscription.deleted marca la suscripción como CANCELLED', async () => {
      await handleWebhookEvent({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_123' } },
      } as unknown as Stripe.Event);

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeSubscriptionId: 'sub_123' },
          data: expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false }),
        })
      );
    });

    it('ignora silenciosamente los tipos de evento no manejados', async () => {
      await handleWebhookEvent({
        type: 'payment_intent.succeeded',
        data: { object: {} },
      } as unknown as Stripe.Event);

      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe('createPaymentLink — validación de monto', () => {
    beforeEach(() => {
      mock(prisma.business.findUnique).mockResolvedValue({ name: 'Barbería', currency: 'ARS' });
    });

    it('rechaza montos menores o iguales a 0', async () => {
      await expect(
        createPaymentLink('biz_1', { amount: 0, description: 'Seña' })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(stripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('crea el link con el monto en centavos y devuelve la URL', async () => {
      mock(stripeInstance.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.com/x' });

      const url = await createPaymentLink('biz_1', { amount: 15.5, description: 'Seña' });

      expect(url).toBe('https://checkout.stripe.com/x');
      const arg = mock(stripeInstance.checkout.sessions.create).mock.calls[0][0] as {
        line_items: { price_data: { unit_amount: number; currency: string } }[];
      };
      expect(arg.line_items[0].price_data.unit_amount).toBe(1550);
      expect(arg.line_items[0].price_data.currency).toBe('ars');
    });

    it('falla con 404 si el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);
      await expect(
        createPaymentLink('biz_x', { amount: 10, description: 'x' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('constructWebhookEvent — verificación de firma', () => {
    it('lanza error si falta STRIPE_WEBHOOK_SECRET', () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      expect(() => constructWebhookEvent(Buffer.from('{}'), 'sig')).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it('delega en el SDK cuando el secret está configurado', () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const evt = { id: 'evt_1', type: 'checkout.session.completed' };
      mock(stripeInstance.webhooks.constructEvent).mockReturnValue(evt);

      const result = constructWebhookEvent(Buffer.from('{}'), 'sig_abc');

      expect(result).toBe(evt);
      expect(stripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
        expect.any(Buffer),
        'sig_abc',
        'whsec_test'
      );
    });
  });
});
