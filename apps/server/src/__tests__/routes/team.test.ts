/**
 * Pruebas de integracion para las rutas de equipo
 * (`src/routes/team.ts`): listar miembros con scope por negocio, invitar
 * (201 + validacion 400 + 409 duplicado), actualizar y eliminar con
 * aislamiento multi-tenant (el where usa businessId del auth).
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
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../middleware/auth', () => ({
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

  describe('POST /api/team/invite', () => {
    const validPayload = { email: 'nuevo@example.com', role: 'PROFESSIONAL' };

    it('invita a un miembro (201) inyectando el businessId del auth', async () => {
      mock(prisma.teamMember.findUnique).mockResolvedValue(null);
      mock(prisma.teamMember.create).mockResolvedValue({ id: 'm1', ...validPayload });

      const res = await request(app).post('/api/team/invite').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.teamMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'nuevo@example.com',
            role: 'PROFESSIONAL',
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 409 si el miembro ya existe', async () => {
      mock(prisma.teamMember.findUnique).mockResolvedValue({ id: 'existente' });

      const res = await request(app).post('/api/team/invite').send(validPayload);

      expect(res.status).toBe(409);
      expect(prisma.teamMember.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando falta el email (validacion Zod)', async () => {
      const res = await request(app).post('/api/team/invite').send({ role: 'PROFESSIONAL' });

      expect(res.status).toBe(400);
      expect(prisma.teamMember.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un role invalido', async () => {
      const res = await request(app)
        .post('/api/team/invite')
        .send({ email: 'nuevo@example.com', role: 'SUPERADMIN' });

      expect(res.status).toBe(400);
      expect(prisma.teamMember.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/team/members/:id', () => {
    it('actualiza el miembro con scope por businessId (anti cross-tenant)', async () => {
      mock(prisma.teamMember.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.teamMember.findFirst).mockResolvedValue({ id: 'm1', role: 'ADMIN' });

      const res = await request(app).patch('/api/team/members/m1').send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(prisma.teamMember.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 si el miembro no pertenece al negocio (updateMany count 0)', async () => {
      mock(prisma.teamMember.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app).patch('/api/team/members/de-otro-negocio').send({ role: 'ADMIN' });

      expect(res.status).toBe(404);
      expect(prisma.teamMember.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/team/members/:id', () => {
    it('elimina el miembro con scope por businessId (204)', async () => {
      mock(prisma.teamMember.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/team/members/m1');

      expect(res.status).toBe(204);
      expect(prisma.teamMember.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 si el miembro no pertenece al negocio (deleteMany count 0)', async () => {
      mock(prisma.teamMember.deleteMany).mockResolvedValue({ count: 0 });

      const res = await request(app).delete('/api/team/members/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });
});
