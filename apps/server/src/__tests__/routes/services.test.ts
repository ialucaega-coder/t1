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
    category: { findFirst: vi.fn() },
    service: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
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
          where: { businessId: 'biz_1', deletedAt: null },
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
    it('actualiza parcialmente un servicio existente (scope por negocio, sin dados de baja)', async () => {
      (prisma.service.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', name: 'Nuevo nombre' });

      const res = await request(app)
        .put('/api/services/svc_1')
        .send({ name: 'Nuevo nombre' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Nuevo nombre');
      expect(prisma.service.updateMany).toHaveBeenCalledWith({
        where: { id: 'svc_1', businessId: 'biz_1', deletedAt: null },
        data: { name: 'Nuevo nombre' },
      });
    });

    it('devuelve 404 si el servicio no existe, es de otro negocio o esta dado de baja', async () => {
      (prisma.service.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      const res = await request(app).put('/api/services/no-existe').send({ name: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/services/:id (baja logica)', () => {
    it('da de baja el servicio (deletedAt + isActive=false) con scope por negocio, sin borrado fisico', async () => {
      (prisma.service.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/services/svc_1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(prisma.service.updateMany).toHaveBeenCalledWith({
        where: { id: 'svc_1', businessId: 'biz_1', deletedAt: null },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
    });

    it('devuelve 404 si no es del negocio o ya estaba dado de baja', async () => {
      (prisma.service.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      const res = await request(app).delete('/api/services/svc_1');

      expect(res.status).toBe(404);
    });
  });

  describe('topes de precio y duracion', () => {
    it('rechaza una duracion mayor a 1440 minutos con mensaje claro', async () => {
      const res = await request(app).post('/api/services').send({ name: 'Largo', duration: 1441, price: 100 });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain('La duración no puede superar 1440 minutos');
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('acepta exactamente 1440 minutos', async () => {
      (prisma.service.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
      const res = await request(app).post('/api/services').send({ name: 'Dia', duration: 1440, price: 100 });
      expect(res.status).toBe(201);
    });

    it('rechaza un precio mayor al maximo de la columna', async () => {
      const res = await request(app).post('/api/services').send({ name: 'Caro', duration: 30, price: 100_000_000 });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain('El precio no puede superar 99.999.999,99');
    });
  });

  describe('image, sortOrder y categoria', () => {
    const payload = { name: 'Corte', duration: 30, price: 5000 };

    it('POST acepta image https y sortOrder y los guarda', async () => {
      (prisma.service.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });

      const res = await request(app)
        .post('/api/services')
        .send({ ...payload, image: 'https://cdn.example.com/c.jpg', sortOrder: 2 });

      expect(res.status).toBe(201);
      expect(prisma.service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ image: 'https://cdn.example.com/c.jpg', sortOrder: 2 }),
        })
      );
    });

    it('POST rechaza image data: o javascript:', async () => {
      for (const image of ['data:image/svg+xml;base64,AAAA', 'javascript:alert(1)']) {
        const res = await request(app).post('/api/services').send({ ...payload, image });
        expect(res.status).toBe(400);
      }
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('POST rechaza una categoria de otro negocio', async () => {
      (prisma.category.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await request(app).post('/api/services').send({ ...payload, categoryId: 'cat_ajena' });
      expect(res.status).toBe(400);
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('PUT rechaza una categoria de otro negocio', async () => {
      (prisma.category.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await request(app).put('/api/services/s1').send({ categoryId: 'cat_ajena' });
      expect(res.status).toBe(400);
      expect(prisma.service.updateMany).not.toHaveBeenCalled();
    });
  });
});
