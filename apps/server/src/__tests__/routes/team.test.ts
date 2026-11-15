/**
 * Pruebas de integracion para las rutas de equipo
 * (`src/routes/team.ts`): listar miembros con scope por negocio y permisos
 * granulares. Invitar / reenviar / cambiar rol / quitar (flujo de invitaciones,
 * sincronizacion de User.role, ultimo ADMIN) se prueban en team-invites.test.ts.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth + requireRole).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    teamMember: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    // Invitaciones pendientes (TEAM_INVITES): GET /members lee sus vencimientos.
    connection: { findFirst: vi.fn(async () => null) },
  },
}));

// Mockeamos el servicio de permisos: su lógica (defaults, saneo, lock) ya se
// prueba aparte en services/team-permissions.test.ts. Acá solo verificamos el
// cableado de las rutas (scope por negocio, 404, validación Zod).
vi.mock('../../services/team/permissions', () => ({
  PERMISSION_CATALOG: [{ key: 'clients', label: 'Clientes', description: '' }],
  ROLE_DEFAULTS: { ADMIN: ['clients'], PROFESSIONAL: ['clients'], VIEWER: ['clients'] },
  CAPABILITY_KEYS: ['clients', 'bots'],
  PLAN_LABELS: { FREE: 'Gratis', STARTER: 'Starter', PRO: 'Pro', ENTERPRISE: 'Enterprise' },
  normalizeRole: (r: string) => r,
  resolveCapabilities: vi.fn(() => ['clients']),
  loadPermissionOverrides: vi.fn(async () => ({ m1: ['clients'] })),
  saveMemberPermissions: vi.fn(async () => ['clients']),
  loadBusinessPlanTier: vi.fn(async () => 'STARTER'),
  capabilitiesForPlan: vi.fn(() => ['clients']),
}));

vi.mock('../../middleware/auth', () => ({
  requireStaff: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (!roles.includes(req.auth?.role ?? '')) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    },
}));

import { prisma } from '../../lib/prisma';
import { teamRouter } from '../../routes/team';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/team', teamRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/team', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/team/members', () => {
    it('lista los miembros del negocio (scope por businessId)', async () => {
      mock(prisma.teamMember.findMany).mockResolvedValue([{ id: 'm1', email: 'a@b.com' }]);

      const res = await request(app).get('/api/team/members');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.teamMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });
  });

  describe('GET /api/team/permissions', () => {
    it('devuelve catálogo, defaults por rol, overrides y el plan del negocio', async () => {
      const res = await request(app).get('/api/team/permissions');

      expect(res.status).toBe(200);
      expect(res.body.catalog).toBeInstanceOf(Array);
      expect(res.body.roleDefaults).toHaveProperty('ADMIN');
      expect(res.body.overrides).toEqual({ m1: ['clients'] });
      expect(res.body.planTier).toBe('STARTER');
      expect(res.body.planLabel).toBe('Starter');
      expect(res.body.planCapabilities).toEqual(['clients']);
    });
  });

  describe('GET /api/team/my-access', () => {
    it('devuelve el acceso efectivo del usuario (rol + plan)', async () => {
      const res = await request(app).get('/api/team/my-access');

      expect(res.status).toBe(200);
      expect(res.body.planTier).toBe('STARTER');
      expect(res.body.roleCapabilities).toEqual(['clients']);
      expect(res.body.planCapabilities).toEqual(['clients']);
    });
  });

  describe('PUT /api/team/permissions/:memberId', () => {
    it('guarda las capacidades del miembro (scope por negocio) y devuelve las efectivas', async () => {
      mock(prisma.teamMember.findFirst).mockResolvedValue({ role: 'PROFESSIONAL' });

      const res = await request(app)
        .put('/api/team/permissions/m1')
        .send({ permissions: ['clients'] });

      expect(res.status).toBe(200);
      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm1', businessId: 'biz_1' } })
      );
      expect(res.body).toEqual({ memberId: 'm1', role: 'PROFESSIONAL', permissions: ['clients'] });
    });

    it('devuelve 404 si el miembro no pertenece al negocio', async () => {
      mock(prisma.teamMember.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .put('/api/team/permissions/de-otro-negocio')
        .send({ permissions: ['clients'] });

      expect(res.status).toBe(404);
    });

    it('devuelve 400 ante una capacidad desconocida (validación Zod)', async () => {
      const res = await request(app)
        .put('/api/team/permissions/m1')
        .send({ permissions: ['inexistente'] });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/team/permissions/:memberId', () => {
    it('resetea al default del rol (200) con scope por negocio', async () => {
      mock(prisma.teamMember.findFirst).mockResolvedValue({ role: 'VIEWER' });

      const res = await request(app).delete('/api/team/permissions/m1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ memberId: 'm1', role: 'VIEWER', permissions: ['clients'] });
    });

    it('devuelve 404 si el miembro no pertenece al negocio', async () => {
      mock(prisma.teamMember.findFirst).mockResolvedValue(null);

      const res = await request(app).delete('/api/team/permissions/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });
});
