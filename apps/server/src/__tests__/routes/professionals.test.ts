/**
 * Pruebas de integracion para las rutas de profesionales
 * (`src/routes/professionals.ts`): listado, detalle, disponibilidad, creacion,
 * actualizacion y borrado (con desactivacion si tiene reservas).
 *
 * Se mockea Prisma y se usa el middleware de auth real con JWT firmado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    professional: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findFirst: vi.fn(), create: vi.fn() },
    schedule: { findFirst: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { professionalsRouter } from '../../routes/professionals';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/professionals', professionalsRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/professionals', () => {
  const app = buildApp();
  const token = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/professionals', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/professionals');
      expect(res.status).toBe(401);
    });

    it('devuelve la lista de profesionales del negocio', async () => {
      mock(prisma.professional.findMany).mockResolvedValue([{ id: 'p1' }]);

      const res = await request(app).get('/api/professionals').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.professional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });
  });

  describe('GET /api/professionals/:id', () => {
    it('devuelve el detalle del profesional', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue({ id: 'p1', user: { name: 'Ana' } });

      const res = await request(app).get('/api/professionals/p1').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('p1');
    });

    it('devuelve 404 si el profesional no existe', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue(null);

      const res = await request(app).get('/api/professionals/no-existe').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/professionals/:id/availability', () => {
    it('devuelve 400 si falta el parametro date', async () => {
      const res = await request(app)
        .get('/api/professionals/p1/availability')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('devuelve available:false si no hay horario ese dia', async () => {
      mock(prisma.schedule.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/professionals/p1/availability')
        .query({ date: '2026-01-05' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false, slots: [] });
    });

    it('calcula slots de 30 min descartando los ya reservados', async () => {
      mock(prisma.schedule.findFirst).mockResolvedValue({
        startTime: '09:00',
        endTime: '10:00',
      });
      mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '09:00', endTime: '09:30' }]);

      const res = await request(app)
        .get('/api/professionals/p1/availability')
        .query({ date: '2026-01-05' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      // 09:00 esta reservado, queda 09:30
      expect(res.body.slots).toEqual(['09:30']);
    });
  });

  describe('POST /api/professionals', () => {
    const validPayload = { name: 'Ana', email: 'ana@x.com' };

    it('crea un profesional reutilizando el user existente', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'u1', email: 'ana@x.com' });
      mock(prisma.professional.aggregate).mockResolvedValue({ _max: { sortOrder: 2 } });
      mock(prisma.professional.create).mockResolvedValue({ id: 'p1', userId: 'u1' });

      const res = await request(app)
        .post('/api/professionals')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.professional.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', sortOrder: 3 }) })
      );
    });

    it('crea el user si no existe', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);
      mock(prisma.user.create).mockResolvedValue({ id: 'u_new', email: 'ana@x.com' });
      mock(prisma.professional.aggregate).mockResolvedValue({ _max: { sortOrder: null } });
      mock(prisma.professional.create).mockResolvedValue({ id: 'p1', userId: 'u_new' });

      const res = await request(app)
        .post('/api/professionals')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.user.create).toHaveBeenCalled();
      // sortOrder arranca en 1 cuando no habia profesionales
      expect(prisma.professional.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sortOrder: 1 }) })
      );
    });

    it('devuelve 400 con email invalido', async () => {
      const res = await request(app)
        .post('/api/professionals')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ana', email: 'no-es-email' });

      expect(res.status).toBe(400);
    });

    it('devuelve 400 cuando falta el nombre', async () => {
      const res = await request(app)
        .post('/api/professionals')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'ana@x.com' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/professionals/:id', () => {
    it('actualiza un profesional existente', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue({ id: 'p1' });
      mock(prisma.professional.update).mockResolvedValue({ id: 'p1', bio: 'Nueva bio' });

      const res = await request(app)
        .put('/api/professionals/p1')
        .set('Authorization', `Bearer ${token}`)
        .send({ bio: 'Nueva bio' });

      expect(res.status).toBe(200);
      expect(res.body.bio).toBe('Nueva bio');
    });

    it('devuelve 404 si el profesional no existe', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .put('/api/professionals/no-existe')
        .set('Authorization', `Bearer ${token}`)
        .send({ bio: 'x' });

      expect(res.status).toBe(404);
      expect(prisma.professional.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/professionals/:id', () => {
    it('elimina un profesional sin reservas', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue({ id: 'p1', _count: { bookings: 0 } });
      mock(prisma.professional.delete).mockResolvedValue({});

      const res = await request(app).delete('/api/professionals/p1').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(prisma.professional.delete).toHaveBeenCalled();
    });

    it('desactiva (no borra) un profesional con reservas', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue({ id: 'p1', _count: { bookings: 5 } });
      mock(prisma.professional.update).mockResolvedValue({ id: 'p1', isAvailable: false });

      const res = await request(app).delete('/api/professionals/p1').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deactivated/);
      expect(prisma.professional.delete).not.toHaveBeenCalled();
      expect(prisma.professional.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isAvailable: false } })
      );
    });

    it('devuelve 404 si el profesional no existe', async () => {
      mock(prisma.professional.findUnique).mockResolvedValue(null);

      const res = await request(app).delete('/api/professionals/no-existe').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});
