/**
 * Pruebas de integracion para las rutas de horarios (`src/routes/schedules.ts`):
 * listado (filtrable por profesional), creacion (ADMIN), actualizacion y borrado.
 *
 * Se mockea Prisma y se usa el middleware de auth real con JWT firmado para
 * probar 401/403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    schedule: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';
import { schedulesRouter } from '../../routes/schedules';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/schedules', schedulesRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/schedules', () => {
  const app = buildApp();
  const adminToken = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });
  const clientToken = signToken({ userId: 'user_2', businessId: 'biz_1', role: 'CLIENT' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/schedules', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/schedules');
      expect(res.status).toBe(401);
    });

    it('lista los horarios del negocio', async () => {
      mock(prisma.schedule.findMany).mockResolvedValue([{ id: 's1', dayOfWeek: 1 }]);

      const res = await request(app).get('/api/schedules').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.schedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });

    it('filtra por professionalId cuando se pasa en query', async () => {
      mock(prisma.schedule.findMany).mockResolvedValue([]);

      await request(app)
        .get('/api/schedules')
        .query({ professionalId: 'prof_1' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(prisma.schedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', professionalId: 'prof_1' } })
      );
    });
  });

  describe('POST /api/schedules', () => {
    const validPayload = {
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '18:00',
      professionalId: 'prof_1',
    };

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(prisma.schedule.create).not.toHaveBeenCalled();
    });

    it('crea un horario con datos validos', async () => {
      mock(prisma.schedule.create).mockResolvedValue({ id: 's1', ...validPayload });

      const res = await request(app)
        .post('/api/schedules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.schedule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ businessId: 'biz_1', dayOfWeek: 1 }) })
      );
    });

    it('devuelve 400 con formato de hora invalido', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validPayload, startTime: '9am' });

      expect(res.status).toBe(400);
    });

    it('devuelve 400 con dayOfWeek fuera de rango', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validPayload, dayOfWeek: 8 });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/schedules/:id', () => {
    it('actualiza un horario existente', async () => {
      mock(prisma.schedule.update).mockResolvedValue({ id: 's1', startTime: '10:00' });

      const res = await request(app)
        .put('/api/schedules/s1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime: '10:00' });

      expect(res.status).toBe(200);
      expect(res.body.startTime).toBe('10:00');
      expect(prisma.schedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 403 para rol no ADMIN', async () => {
      const res = await request(app)
        .put('/api/schedules/s1')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ startTime: '10:00' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/schedules/:id', () => {
    it('elimina un horario existente', async () => {
      mock(prisma.schedule.delete).mockResolvedValue({});

      const res = await request(app)
        .delete('/api/schedules/s1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(prisma.schedule.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 403 para rol no ADMIN', async () => {
      const res = await request(app)
        .delete('/api/schedules/s1')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(prisma.schedule.delete).not.toHaveBeenCalled();
    });
  });
});
