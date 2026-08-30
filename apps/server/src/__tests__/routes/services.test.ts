/**
 * Pruebas de integracion (stubs) para las rutas de servicios
 * (`src/routes/services.ts`): listar, crear y actualizar servicios.
 *
 * Prisma y el middleware de autenticacion se mockean para aislar la
 * logica de la ruta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    service: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
import { servicesRouter } from '../../routes/services';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/services', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/services', () => {
    it('devuelve la lista de servicios del negocio ordenados por sortOrder', async () => {
      (prisma.service.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'svc_1', name: 'Corte' },
      ]);

      const res = await request(app).get('/api/services');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1' },
          orderBy: { sortOrder: 'asc' },
        })
      );
    });

    it('devuelve 500 si Prisma falla', async () => {
      (prisma.service.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'));

      const res = await request(app).get('/api/services');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/services', () => {
    const validPayload = {
      name: 'Corte de pelo',
      duration: 30,
      price: 1500,
    };

    it('crea un servicio con datos validos', async () => {
      (prisma.service.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'svc_1',
        ...validPayload,
        businessId: 'biz_1',
      });

      const res = await request(app).post('/api/services').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Corte de pelo', businessId: 'biz_1' }),
        })
      );
    });

    it('devuelve 400 cuando el precio o la duracion son invalidos', async () => {
      const res = await request(app)
        .post('/api/services')
        .send({ name: 'Servicio', duration: -1, price: -10 });

      expect(res.status).toBe(400);
    });

    it('devuelve 400 cuando falta el nombre', async () => {
      const res = await request(app).post('/api/services').send({ duration: 30, price: 100 });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/services/:id', () => {
    it('actualiza parcialmente un servicio existente', async () => {
      (prisma.service.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'svc_1',
        name: 'Nuevo nombre',
      });

      const res = await request(app)
        .put('/api/services/svc_1')
        .send({ name: 'Nuevo nombre' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Nuevo nombre');
      expect(prisma.service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'svc_1', businessId: 'biz_1' },
          data: { name: 'Nuevo nombre' },
        })
      );
    });

    it('devuelve 500 si el servicio no existe', async () => {
      (prisma.service.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

      const res = await request(app).put('/api/services/no-existe').send({ name: 'X' });

      expect(res.status).toBe(500);
    });
  });
});
