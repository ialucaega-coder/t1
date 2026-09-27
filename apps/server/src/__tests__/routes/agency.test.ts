/**
 * Pruebas de integracion para las rutas de agencia
 * (`src/routes/agency.ts`): stats, listado con scope por negocio,
 * creacion (con validacion), actualizacion y borrado con aislamiento
 * multi-tenant (updateMany/deleteMany filtrados por businessId).
 *
 * Se mockean Prisma y el middleware de auth (requireAuth setea req.auth;
 * requireRole chequea el rol).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    agencyClient: {
      count: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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
import { agencyRouter } from '../../routes/agency';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agency', agencyRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/agency', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/agency/stats', () => {
    it('devuelve las metricas agregadas con scope por businessId', async () => {
      mock(prisma.agencyClient.count)
        .mockResolvedValueOnce(3) // totalClients
        .mockResolvedValueOnce(2); // activeClients
      mock(prisma.agencyClient.aggregate)
        .mockResolvedValueOnce({ _sum: { bots: 12 } }) // activeBots
        .mockResolvedValueOnce({ _sum: { revenue: 5000 } }); // totalRevenue

      const res = await request(app).get('/api/agency/stats');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        totalBusinesses: 3,
        totalBots: 12,
        activeClients: 2,
        commission: '20%',
      });
      expect(prisma.agencyClient.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });

    it('devuelve 500 si Prisma falla', async () => {
      mock(prisma.agencyClient.count).mockRejectedValue(new Error('db error'));
      mock(prisma.agencyClient.aggregate).mockResolvedValue({ _sum: {} });

      const res = await request(app).get('/api/agency/stats');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/agency/clients', () => {
    it('devuelve la lista paginada con scope por businessId', async () => {
      mock(prisma.agencyClient.findMany).mockResolvedValue([{ id: 'ac1', name: 'Cliente 1' }]);
      mock(prisma.agencyClient.count).mockResolvedValue(1);

      const res = await request(app).get('/api/agency/clients');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(res.body.data).toHaveLength(1);
      expect(prisma.agencyClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });

    it('agrega el filtro de busqueda por nombre cuando se pasa ?search', async () => {
      mock(prisma.agencyClient.findMany).mockResolvedValue([]);
      mock(prisma.agencyClient.count).mockResolvedValue(0);

      await request(app).get('/api/agency/clients').query({ search: 'acme' });

      expect(prisma.agencyClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            name: { contains: 'acme', mode: 'insensitive' },
          }),
        })
      );
    });

    it('respeta la paginacion page/pageSize (skip/take)', async () => {
      mock(prisma.agencyClient.findMany).mockResolvedValue([]);
      mock(prisma.agencyClient.count).mockResolvedValue(0);

      await request(app).get('/api/agency/clients').query({ page: '3', pageSize: '10' });

      expect(prisma.agencyClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  describe('POST /api/agency/clients', () => {
    it('crea un cliente con datos validos (201) inyectando el businessId del auth', async () => {
      mock(prisma.agencyClient.create).mockResolvedValue({ id: 'ac1', name: 'Acme' });

      const res = await request(app).post('/api/agency/clients').send({ name: 'Acme' });

      expect(res.status).toBe(201);
      expect(prisma.agencyClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Acme',
            plan: 'Free',
            status: 'trial',
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 400 cuando falta el nombre (validacion Zod)', async () => {
      const res = await request(app).post('/api/agency/clients').send({ plan: 'Pro' });

      expect(res.status).toBe(400);
      expect(prisma.agencyClient.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando el status no es un valor valido del enum', async () => {
      const res = await request(app)
        .post('/api/agency/clients')
        .send({ name: 'Acme', status: 'no-valido' });

      expect(res.status).toBe(400);
      expect(prisma.agencyClient.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/agency/clients/:id', () => {
    it('actualiza el cliente cuando pertenece al negocio', async () => {
      mock(prisma.agencyClient.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.agencyClient.findFirst).mockResolvedValue({ id: 'ac1', name: 'Nuevo' });

      const res = await request(app).patch('/api/agency/clients/ac1').send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'ac1' });
      expect(prisma.agencyClient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ac1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 si el cliente no pertenece al negocio (anti cross-tenant)', async () => {
      mock(prisma.agencyClient.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app)
        .patch('/api/agency/clients/de-otro-negocio')
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(404);
      expect(prisma.agencyClient.findFirst).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando revenue es negativo (validacion Zod)', async () => {
      const res = await request(app).patch('/api/agency/clients/ac1').send({ revenue: -10 });

      expect(res.status).toBe(400);
      expect(prisma.agencyClient.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/agency/clients/:id', () => {
    it('elimina el cliente cuando pertenece al negocio (204)', async () => {
      mock(prisma.agencyClient.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/agency/clients/ac1');

      expect(res.status).toBe(204);
      expect(prisma.agencyClient.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ac1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 si el cliente no pertenece al negocio (anti cross-tenant)', async () => {
      mock(prisma.agencyClient.deleteMany).mockResolvedValue({ count: 0 });

      const res = await request(app).delete('/api/agency/clients/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });
});
