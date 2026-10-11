/**
 * Pruebas de integración para las rutas del Super Admin (`src/routes/platform.ts`)
 * y su guard (`src/middleware/platformAdmin.ts`).
 *
 * Se usan los middlewares REALES `requireAuth` + `requirePlatformAdmin` (igual
 * que en index.ts) para verificar de punta a punta: 401 sin token, 403 fuera de
 * la allowlist, y el acceso OK de un email allowlisteado. Prisma se mockea por
 * completo (no hay DB real) y el servicio de revocación se mockea a "no revocado".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// La allowlist se lee de la env en cada request del guard. La fijamos acá (el
// setup global no la define) para controlar quién es Super Admin en los tests.
process.env.PLATFORM_ADMIN_EMAILS = 'owner@localb.app, segundo@localb.app';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    business: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    plan: { findUnique: vi.fn() },
    subscription: { upsert: vi.fn() },
    connection: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

// La revocación de sesiones no es el objeto de estas pruebas: la neutralizamos.
vi.mock('../../services/auth/revocation', () => ({
  isSessionRevoked: vi.fn(async () => false),
}));

import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { requirePlatformAdmin } from '../../middleware/platformAdmin';
import { platformRouter } from '../../routes/platform';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const mock = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function signToken(userId: string) {
  return jwt.sign({ userId, businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/platform', requireAuth, requirePlatformAdmin, platformRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/platform (Super Admin)', () => {
  const app = buildApp();
  const token = signToken('user_owner');

  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto el usuario del token es un Super Admin allowlisteado.
    mock(prisma.user.findUnique).mockResolvedValue({ email: 'owner@localb.app' });
  });

  describe('guard requirePlatformAdmin', () => {
    it('permite a un email de la allowlist (200)', async () => {
      mock(prisma.business.count).mockResolvedValue(0);
      mock(prisma.business.findMany).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/platform/businesses')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('permite con email en otra capitalización / espacios (case-insensitive + trim)', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ email: '  OWNER@LocalB.app  ' });
      mock(prisma.business.count).mockResolvedValue(0);
      mock(prisma.business.findMany).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/platform/businesses')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('deniega (403) a un usuario autenticado que NO está en la allowlist', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ email: 'random@cliente.com' });

      const res = await request(app)
        .get('/api/platform/businesses')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(prisma.business.findMany).not.toHaveBeenCalled();
    });

    it('deniega (403) si no se encuentra el usuario', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/platform/businesses')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('devuelve 401 sin token de autenticación', async () => {
      const res = await request(app).get('/api/platform/businesses');

      expect(res.status).toBe(401);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/platform/businesses', () => {
    it('lista los negocios cross-tenant con plan, estado y conteos', async () => {
      mock(prisma.business.count).mockResolvedValue(1);
      mock(prisma.business.findMany).mockResolvedValue([
        {
          id: 'biz_1',
          name: 'Barbería Uno',
          slug: 'barberia-uno',
          isActive: true,
          createdAt: new Date('2026-01-01').toISOString(),
          subscription: {
            status: 'ACTIVE',
            cancelAtPeriodEnd: false,
            currentPeriodEnd: new Date('2027-01-01').toISOString(),
            plan: { tier: 'PRO', name: 'Pro' },
          },
          _count: { users: 3, bots: 2 },
        },
      ]);

      const res = await request(app)
        .get('/api/platform/businesses?page=1&pageSize=20')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.businesses).toHaveLength(1);
      expect(res.body.businesses[0]).toMatchObject({
        id: 'biz_1',
        name: 'Barbería Uno',
        planTier: 'PRO',
        planName: 'Pro',
        subscriptionStatus: 'ACTIVE',
        usersCount: 3,
        botsCount: 2,
      });
    });

    it('mapea planTier null cuando el negocio no tiene suscripción', async () => {
      mock(prisma.business.count).mockResolvedValue(1);
      mock(prisma.business.findMany).mockResolvedValue([
        {
          id: 'biz_2',
          name: 'Sin plan',
          slug: 'sin-plan',
          isActive: true,
          createdAt: new Date().toISOString(),
          subscription: null,
          _count: { users: 1, bots: 0 },
        },
      ]);

      const res = await request(app)
        .get('/api/platform/businesses')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.businesses[0].planTier).toBeNull();
      expect(res.body.businesses[0].subscriptionStatus).toBeNull();
    });
  });

  describe('PATCH /api/platform/businesses/:id/active', () => {
    it('suspende un negocio (toggle isActive)', async () => {
      mock(prisma.business.update).mockResolvedValue({
        id: 'biz_1',
        name: 'Barbería Uno',
        slug: 'barberia-uno',
        isActive: false,
      });

      const res = await request(app)
        .patch('/api/platform/businesses/biz_1/active')
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
      expect(prisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'biz_1' }, data: { isActive: false } }),
      );
    });

    it('devuelve 400 si falta isActive (validación Zod)', async () => {
      const res = await request(app)
        .patch('/api/platform/businesses/biz_1/active')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/platform/businesses/:id/plan', () => {
    it('cambia el plan sin Stripe (upsert de la suscripción)', async () => {
      mock(prisma.business.findUnique).mockResolvedValue({ id: 'biz_1' });
      mock(prisma.plan.findUnique).mockResolvedValue({ id: 'plan_pro', tier: 'PRO', name: 'Pro' });
      mock(prisma.subscription.upsert).mockResolvedValue({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        plan: { tier: 'PRO', name: 'Pro' },
      });

      const res = await request(app)
        .patch('/api/platform/businesses/biz_1/plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'PRO' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ businessId: 'biz_1', planTier: 'PRO', status: 'ACTIVE' });
      expect(prisma.plan.findUnique).toHaveBeenCalledWith({ where: { tier: 'PRO' } });
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } }),
      );
    });

    it('devuelve 404 si no existe un Plan para ese tier', async () => {
      mock(prisma.business.findUnique).mockResolvedValue({ id: 'biz_1' });
      mock(prisma.plan.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/platform/businesses/biz_1/plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'ENTERPRISE' });

      expect(res.status).toBe(404);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('devuelve 404 si el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/platform/businesses/inexistente/plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'PRO' });

      expect(res.status).toBe(404);
      expect(prisma.plan.findUnique).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un tier inválido (validación Zod)', async () => {
      const res = await request(app)
        .patch('/api/platform/businesses/biz_1/plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'SUPER' });

      expect(res.status).toBe(400);
      expect(prisma.business.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('feature flags (Connection PLATFORM_FEATURE_FLAGS)', () => {
    it('GET devuelve catálogo y flags normalizados del negocio', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { flags: { betaFeatures: true, desconocido: true } },
      });

      const res = await request(app)
        .get('/api/platform/businesses/biz_1/features')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.catalog)).toBe(true);
      // Solo claves del catálogo sobreviven.
      expect(res.body.flags).toEqual({ betaFeatures: true });
    });

    it('PUT guarda solo los flags conocidos del catálogo', async () => {
      const tx = {
        connection: {
          findFirst: vi.fn().mockResolvedValue({ id: 'conn_1' }),
          update: vi.fn().mockResolvedValue({}),
        },
        $queryRaw: vi.fn().mockResolvedValue([]),
      };
      mock(prisma.$transaction).mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

      const res = await request(app)
        .put('/api/platform/businesses/biz_1/features')
        .set('Authorization', `Bearer ${token}`)
        .send({ flags: { betaFeatures: true, prioritySupport: false, desconocido: true } });

      expect(res.status).toBe(200);
      expect(res.body.flags).toEqual({ betaFeatures: true, prioritySupport: false });
      expect(tx.connection.update).toHaveBeenCalled();
    });
  });
});
