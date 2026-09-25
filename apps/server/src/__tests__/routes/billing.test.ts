/**
 * Pruebas de integracion para las rutas de facturacion (`src/routes/billing.ts`):
 * creacion de checkout sessions, portal de facturacion, y el webhook de Stripe.
 *
 * Se mockean por completo Prisma y el modulo `services/stripe` (que envuelve
 * al SDK de Stripe): estas pruebas no hacen llamadas reales a Stripe ni
 * requieren una base de datos real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    plan: {
      findUnique: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
    },
    business: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock('../../services/stripe', () => ({
  createCheckoutSession: vi.fn(),
  createCustomerPortalSession: vi.fn(),
  cancelSubscription: vi.fn(),
  constructWebhookEvent: vi.fn(),
  handleWebhookEvent: vi.fn(),
  createPaymentLink: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import {
  createCheckoutSession,
  createCustomerPortalSession,
  constructWebhookEvent,
  handleWebhookEvent,
  createPaymentLink,
} from '../../services/stripe';
import { billingRouter } from '../../routes/billing';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  // El webhook necesita el body crudo (Buffer) para verificar la firma,
  // igual que en index.ts (registrado antes de express.json()).
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use('/api/billing', billingRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/billing', () => {
  const app = buildApp();
  const adminToken = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });
  const otherBusinessAdminToken = signToken({ userId: 'user_2', businessId: 'biz_2', role: 'ADMIN' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/billing/subscribe', () => {
    const activePlan = {
      id: 'plan_1',
      name: 'Pro',
      isActive: true,
      priceMonthly: 1000,
      priceYearly: 10000,
      currency: 'USD',
    };

    it('crea una checkout session cuando no hay suscripcion previa', async () => {
      (prisma.plan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(activePlan);
      (prisma.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.business.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'biz_1',
        stripeCustomerId: null,
      });
      (createCheckoutSession as ReturnType<typeof vi.fn>).mockResolvedValue('https://checkout.stripe.com/session_123');

      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: 'plan_1', interval: 'monthly' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: 'https://checkout.stripe.com/session_123' });
      expect(createCheckoutSession).toHaveBeenCalledWith('biz_1', 'plan_1', 'monthly', undefined);
    });

    it('usa el businessId del token (req.auth), no un valor enviado en el body', async () => {
      (prisma.plan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(activePlan);
      (prisma.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.business.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'biz_2',
        stripeCustomerId: null,
      });
      (createCheckoutSession as ReturnType<typeof vi.fn>).mockResolvedValue('https://checkout.stripe.com/session_456');

      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${otherBusinessAdminToken}`)
        // Intento de inyectar un businessId ajeno en el body: el schema
        // no lo declara, asi que zod lo descarta y nunca llega a la ruta.
        .send({ planId: 'plan_1', interval: 'monthly', businessId: 'biz_1' });

      expect(res.status).toBe(200);
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { businessId: 'biz_2' } });
      expect(createCheckoutSession).toHaveBeenCalledWith('biz_2', 'plan_1', 'monthly', undefined);
    });

    it('devuelve 404 si el plan no existe', async () => {
      (prisma.plan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: 'plan_inexistente', interval: 'monthly' });

      expect(res.status).toBe(404);
      expect(createCheckoutSession).not.toHaveBeenCalled();
    });

    it('devuelve 404 si el plan existe pero esta inactivo', async () => {
      (prisma.plan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...activePlan,
        isActive: false,
      });

      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: 'plan_1', interval: 'monthly' });

      expect(res.status).toBe(404);
      expect(createCheckoutSession).not.toHaveBeenCalled();
    });

    it('devuelve 409 si el negocio ya tiene una suscripcion no cancelada', async () => {
      (prisma.plan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(activePlan);
      (prisma.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub_1',
        businessId: 'biz_1',
        status: 'ACTIVE',
      });

      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: 'plan_1', interval: 'monthly' });

      expect(res.status).toBe(409);
      expect(createCheckoutSession).not.toHaveBeenCalled();
    });

    it('permite re-suscribirse si la suscripcion previa esta CANCELLED', async () => {
      (prisma.plan.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(activePlan);
      (prisma.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sub_1',
        businessId: 'biz_1',
        status: 'CANCELLED',
      });
      (prisma.business.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'biz_1',
        stripeCustomerId: 'cus_123',
      });
      (createCheckoutSession as ReturnType<typeof vi.fn>).mockResolvedValue('https://checkout.stripe.com/session_789');

      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planId: 'plan_1', interval: 'monthly' });

      expect(res.status).toBe(200);
      expect(createCheckoutSession).toHaveBeenCalledWith('biz_1', 'plan_1', 'monthly', 'cus_123');
    });

    it('devuelve 401 sin token de autenticacion', async () => {
      const res = await request(app)
        .post('/api/billing/subscribe')
        .send({ planId: 'plan_1', interval: 'monthly' });

      expect(res.status).toBe(401);
      expect(createCheckoutSession).not.toHaveBeenCalled();
    });

    it('devuelve 401 con un token invalido', async () => {
      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', 'Bearer token-invalido')
        .send({ planId: 'plan_1', interval: 'monthly' });

      expect(res.status).toBe(401);
    });

    it('devuelve 400 cuando el body no cumple el schema', async () => {
      const res = await request(app)
        .post('/api/billing/subscribe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ interval: 'monthly' });

      expect(res.status).toBe(400);
      expect(createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/billing/portal', () => {
    it('crea una sesion del customer portal correctamente', async () => {
      (prisma.business.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'biz_1',
        stripeCustomerId: 'cus_123',
      });
      (createCustomerPortalSession as ReturnType<typeof vi.fn>).mockResolvedValue('https://billing.stripe.com/portal_123');

      const res = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: 'https://billing.stripe.com/portal_123' });
      expect(createCustomerPortalSession).toHaveBeenCalledWith('cus_123');
    });

    it('devuelve 400 si el negocio no tiene un customer de Stripe asociado', async () => {
      (prisma.business.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'biz_1',
        stripeCustomerId: null,
      });

      const res = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(createCustomerPortalSession).not.toHaveBeenCalled();
    });

    it('devuelve 401 sin token de autenticacion', async () => {
      const res = await request(app).post('/api/billing/portal').send({});

      expect(res.status).toBe(401);
      expect(createCustomerPortalSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/billing/payment-link', () => {
    it('genera un link de pago con datos válidos (ADMIN)', async () => {
      (createPaymentLink as ReturnType<typeof vi.fn>).mockResolvedValue('https://checkout.stripe.com/pay_123');

      const res = await request(app)
        .post('/api/billing/payment-link')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 1500, description: 'Seña de turno' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: 'https://checkout.stripe.com/pay_123' });
      expect(createPaymentLink).toHaveBeenCalledWith('biz_1', {
        amount: 1500,
        description: 'Seña de turno',
        currency: undefined,
      });
    });

    it('usa el businessId del token, no uno enviado en el body', async () => {
      (createPaymentLink as ReturnType<typeof vi.fn>).mockResolvedValue('https://checkout.stripe.com/pay_456');

      const res = await request(app)
        .post('/api/billing/payment-link')
        .set('Authorization', `Bearer ${otherBusinessAdminToken}`)
        .send({ amount: 2000, description: 'Producto', businessId: 'biz_1' });

      expect(res.status).toBe(200);
      expect(createPaymentLink).toHaveBeenCalledWith('biz_2', expect.objectContaining({ amount: 2000 }));
    });

    it('devuelve 400 si el monto no es positivo', async () => {
      const res = await request(app)
        .post('/api/billing/payment-link')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0, description: 'Algo' });

      expect(res.status).toBe(400);
      expect(createPaymentLink).not.toHaveBeenCalled();
    });

    it('devuelve 400 si falta la descripción', async () => {
      const res = await request(app)
        .post('/api/billing/payment-link')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 1500 });

      expect(res.status).toBe(400);
      expect(createPaymentLink).not.toHaveBeenCalled();
    });

    it('devuelve 401 sin token de autenticación', async () => {
      const res = await request(app)
        .post('/api/billing/payment-link')
        .send({ amount: 1500, description: 'Seña' });

      expect(res.status).toBe(401);
      expect(createPaymentLink).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/billing/webhook', () => {
    it('devuelve 400 si falta el header stripe-signature', async () => {
      const res = await request(app)
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'checkout.session.completed' }));

      expect(res.status).toBe(400);
      expect(constructWebhookEvent).not.toHaveBeenCalled();
      expect(handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('devuelve 400 si la verificacion de la firma falla', async () => {
      (constructWebhookEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Webhook signature verification failed.');
      });

      const res = await request(app)
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'firma-invalida')
        .send(JSON.stringify({ type: 'checkout.session.completed' }));

      expect(res.status).toBe(400);
      expect(handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('procesa correctamente un evento checkout.session.completed', async () => {
      const fakeEvent = {
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            metadata: { businessId: 'biz_1', planId: 'plan_1', interval: 'monthly' },
            subscription: 'sub_123',
            customer: 'cus_123',
          },
        },
      };
      (constructWebhookEvent as ReturnType<typeof vi.fn>).mockReturnValue(fakeEvent);
      (handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'firma-valida')
        .send(JSON.stringify(fakeEvent));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(constructWebhookEvent).toHaveBeenCalledTimes(1);
      expect(handleWebhookEvent).toHaveBeenCalledWith(fakeEvent);
    });

    it('no requiere autenticacion (no exige Authorization header)', async () => {
      (constructWebhookEvent as ReturnType<typeof vi.fn>).mockReturnValue({ type: 'noop' });
      (handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'firma-valida')
        .send(JSON.stringify({ type: 'noop' }));

      expect(res.status).toBe(200);
    });
  });
});
