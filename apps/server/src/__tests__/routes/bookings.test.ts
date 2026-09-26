/**
 * Pruebas de integracion (stubs) para las rutas de reservas
 * (`src/routes/bookings.ts`): listar, crear, actualizar estado y
 * eliminar reservas.
 *
 * Se mockean Prisma y el middleware de autenticacion para poder probar
 * la logica de la ruta de forma aislada, sin base de datos real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
    user: {
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
import { bookingsRouter } from '../../routes/bookings';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/bookings', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/bookings', () => {
    it('devuelve la lista paginada de reservas del negocio', async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'b1', date: '2026-01-01', status: 'PENDING' },
      ]);
      (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const res = await request(app).get('/api/bookings');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_1' }) })
      );
    });

    it('filtra por fecha, estado y profesional cuando se pasan query params', async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await request(app).get('/api/bookings').query({
        date: '2026-01-01',
        status: 'CONFIRMED',
        professionalId: 'prof_1',
      });

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'CONFIRMED',
            professionalId: 'prof_1',
          }),
        })
      );
    });

    it('respeta los parametros de paginacion page y pageSize', async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(45);

      const res = await request(app).get('/api/bookings').query({ page: 2, pageSize: 10 });

      expect(res.body).toMatchObject({ page: 2, pageSize: 10, total: 45, totalPages: 5 });
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });

    it('devuelve 500 si Prisma falla', async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'));
      (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const res = await request(app).get('/api/bookings');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/bookings', () => {
    const validPayload = {
      date: '2026-01-01',
      startTime: '10:00',
      serviceId: 'svc_1',
      professionalId: 'prof_1',
    };

    it('crea una reserva calculando la hora de fin a partir de la duracion del servicio', async () => {
      (prisma.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'svc_1',
        duration: 30,
        price: 1000,
      });
      (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'booking_1',
        startTime: '10:00',
        endTime: '10:30',
      });

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ startTime: '10:00', endTime: '10:30', totalPrice: 1000 }),
        })
      );
    });

    it('devuelve 404 si el servicio no existe', async () => {
      (prisma.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(404);
    });

    it('rechaza (404) un clientId que no pertenece al negocio (anti cross-tenant)', async () => {
      (prisma.service.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'svc_1',
        duration: 30,
        price: 1000,
      });
      // El cliente de otro negocio no aparece al filtrar por businessId.
      (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/bookings')
        .send({ ...validPayload, clientId: 'user_de_otro_negocio' });

      expect(res.status).toBe(404);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user_de_otro_negocio', businessId: 'biz_1' } })
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando faltan campos requeridos', async () => {
      const res = await request(app).post('/api/bookings').send({ date: '2026-01-01' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/bookings/:id/status', () => {
    it('actualiza el estado de la reserva', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'booking_1',
        status: 'CONFIRMED',
      });

      const res = await request(app)
        .patch('/api/bookings/booking_1/status')
        .send({ status: 'CONFIRMED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CONFIRMED');
    });

    it('devuelve 500 si la actualizacion falla (p.ej. reserva inexistente)', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

      const res = await request(app)
        .patch('/api/bookings/no-existe/status')
        .send({ status: 'CONFIRMED' });

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /api/bookings/:id', () => {
    it('elimina la reserva cuando el usuario es ADMIN', async () => {
      (prisma.booking.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await request(app).delete('/api/bookings/booking_1');

      expect(res.status).toBe(204);
      expect(prisma.booking.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'booking_1', businessId: 'biz_1' } })
      );
    });
  });
});
