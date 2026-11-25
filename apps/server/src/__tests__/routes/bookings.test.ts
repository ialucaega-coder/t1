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
      findFirst: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
    },
    professional: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../services/calcom/sync', () => ({ syncBookingToCalcom: vi.fn() }));
vi.mock('../../services/notifications', () => ({ queueNotification: vi.fn() }));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers['x-test-role'] as 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' | undefined) ?? 'ADMIN';
    req.auth = { userId: 'user_1', businessId: 'biz_1', role };
    next();
  },
  requireStaff: (req: Request, res: Response, next: NextFunction) => {
    if (!['ADMIN', 'PROFESSIONAL'].includes(req.auth?.role ?? '')) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
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
import { syncBookingToCalcom } from '../../services/calcom/sync';
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
    // $transaction ejecuta el callback con el propio mock como `tx`; el advisory
    // lock es un no-op en tests. Sin solape por defecto.
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // El profesional existe en el negocio por defecto.
    (prisma.professional.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'prof_1' });
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
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
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
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(404);
    });

    it('rechaza (404) un clientId que no pertenece al negocio (anti cross-tenant)', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
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

    it('rechaza (409) si el turno se solapa con otro del mismo profesional', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'svc_1',
        duration: 30,
        price: 1000,
      });
      // Ya hay un turno 10:00–10:30 del profesional; el nuevo (10:00) se solapa.
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { startTime: '10:00', endTime: '10:30' },
      ]);

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(409);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando faltan campos requeridos', async () => {
      const res = await request(app).post('/api/bookings').send({ date: '2026-01-01' });

      expect(res.status).toBe(400);
    });

    it.each(['99:99', '24:00', '12:60', '9:00', '100:00'])('rechaza (400) la hora de inicio inválida %s', async (startTime) => {
      const res = await request(app).post('/api/bookings').send({ ...validPayload, startTime });

      expect(res.status).toBe(400);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('rechaza (400) un turno que terminaría después de las 24:00 (cruza la medianoche)', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 120, price: 1 });

      const res = await request(app).post('/api/bookings').send({ ...validPayload, startTime: '23:00' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/medianoche/);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('acepta un turno que termina justo a las 24:00', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 60, price: 1 });
      (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'b' });

      const res = await request(app).post('/api/bookings').send({ ...validPayload, startTime: '23:00' });

      expect(res.status).toBe(201);
      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ endTime: '24:00' }) })
      );
    });

    it.each([0, -5, 1441, 2.5])('rechaza (400) un servicio con duración inválida (%s)', async (duration) => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration, price: 1 });

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(400);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('el solape se compara en minutos, no como strings (turno existente 9:00-10:00 con formato corto)', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1 });
      // Como string '9:30' > '10:00' y no se detectaría el solape; en minutos sí (9:30 está dentro de 9:00-10:00).
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ startTime: '9:00', endTime: '10:00' }]);

      const res = await request(app).post('/api/bookings').send({ ...validPayload, startTime: '09:30' });

      expect(res.status).toBe(409);
    });

    it('rechaza (409) un servicio inactivo', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1, isActive: false });

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/no está activo/);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('rechaza (404) un servicio con borrado lógico', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'svc_1', duration: 30, price: 1, isActive: true, deletedAt: new Date(),
      });

      const res = await request(app).post('/api/bookings').send(validPayload);

      expect(res.status).toBe(404);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('Cal.com recibe el instante con offset de Argentina (-03:00), no la hora del servidor', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1 });
      (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'b', client: { name: 'Ana', email: 'a@x.com' } });

      await request(app).post('/api/bookings').send({ ...validPayload, startTime: '10:00' });
      await request(app).post('/api/bookings').send({ ...validPayload, date: '2026-01-01T00:00:00.000Z', startTime: '10:00' });

      const calls = (syncBookingToCalcom as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      // 10:00 en Argentina (UTC-3) = 13:00 UTC; con fecha ISO con hora ya no da Invalid Date.
      expect((calls[0][1].start as Date).toISOString()).toBe('2026-01-01T13:00:00.000Z');
      expect((calls[1][1].start as Date).toISOString()).toBe('2026-01-01T13:00:00.000Z');
    });

    it('devuelve 400 (no 500) con una fecha inválida', async () => {
      const res = await request(app).post('/api/bookings').send({ ...validPayload, date: 'no-es-fecha' });

      expect(res.status).toBe(400);
    });

    it('rechaza (404) un profesional de otro negocio (anti cross-tenant)', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1000 });
      (prisma.professional.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).post('/api/bookings').send({ ...validPayload, professionalId: 'prof_ajeno' });

      expect(res.status).toBe(404);
      expect(prisma.professional.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prof_ajeno', businessId: 'biz_1' } })
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('usa la misma clave de lock para "2026-01-01" y "2026-01-01T00:00:00.000Z" (sin carrera entre altas)', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1000 });
      (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'b' });

      await request(app).post('/api/bookings').send(validPayload);
      await request(app).post('/api/bookings').send({ ...validPayload, date: '2026-01-01T00:00:00.000Z' });

      const calls = (prisma.$executeRaw as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).toBe('booking:biz_1:prof_1:2026-01-01');
      expect(calls[1][1]).toBe(calls[0][1]);
    });
  });

  describe('GET /api/bookings: fecha', () => {
    it('devuelve 400 con una fecha inválida', async () => {
      const res = await request(app).get('/api/bookings').query({ date: 'no-es-fecha' });

      expect(res.status).toBe(400);
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('normaliza la fecha al día (UTC) para la consulta', async () => {
      (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await request(app).get('/api/bookings').query({ date: '2026-01-05T15:30:00.000Z' });

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ date: new Date('2026-01-05') }) })
      );
    });
  });

  describe('GET /api/bookings: solo staff (PII de todos los clientes)', () => {
    it('un CLIENT no puede listar las reservas del negocio (403)', async () => {
      const res = await request(app).get('/api/bookings').set('x-test-role', 'CLIENT');

      expect(res.status).toBe(403);
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('un PROFESSIONAL sí puede listar (200)', async () => {
      (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const res = await request(app).get('/api/bookings').set('x-test-role', 'PROFESSIONAL');

      expect(res.status).toBe(200);
    });

    it('un CLIENT no puede exportar el CSV (403, sin consultar la base)', async () => {
      const res = await request(app).get('/api/bookings/export/csv').set('x-test-role', 'CLIENT');

      expect(res.status).toBe(403);
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('un PROFESSIONAL sí puede exportar el CSV (200)', async () => {
      const res = await request(app).get('/api/bookings/export/csv').set('x-test-role', 'PROFESSIONAL');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/bookings/export/csv', () => {
    it('neutraliza celdas que empiezan con = + - @ o tab (inyección de fórmulas) y conserva las normales', async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          date: new Date('2026-01-05'),
          startTime: '10:00',
          status: 'CONFIRMED',
          service: { name: '=HYPERLINK("http://evil","x")', price: 1000 },
          professional: { user: { name: '+cmd|calc' } },
          client: { name: '@SUM(A1)', email: '-1+1@x.com', phone: '\tTAB' },
        },
        {
          date: new Date('2026-01-06'),
          startTime: '11:00',
          status: 'PENDING',
          service: { name: 'Corte "pro"', price: 500 },
          professional: { user: { name: 'Ana' } },
          client: { name: 'María', email: 'm@x.com', phone: '1122' },
        },
      ]);

      const res = await request(app).get('/api/bookings/export/csv');

      expect(res.status).toBe(200);
      const lines = res.text.replace(/^﻿/, '').split('\n');
      expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
      expect(lines[1]).toContain(`"'+cmd|calc"`);
      expect(lines[1]).toContain(`"'@SUM(A1)"`);
      expect(lines[1]).toContain(`"'-1+1@x.com"`);
      expect(lines[1]).toContain(`"'\tTAB"`);
      // Lo normal queda igual (solo se escapan las comillas dobles).
      expect(lines[2]).toContain('"Corte ""pro"""');
      expect(lines[2]).toContain('"María"');
      expect(lines[2]).not.toContain("'María");
    });
  });

  describe('PATCH /api/bookings/:id (editar / reprogramar)', () => {
    const existing = {
      id: 'booking_1',
      businessId: 'biz_1',
      status: 'CONFIRMED',
      date: new Date('2026-01-01'),
      startTime: '10:00',
      endTime: '10:30',
      serviceId: 'svc_1',
      professionalId: 'prof_1',
    };
    const svc30 = { id: 'svc_1', duration: 30, price: 1000 };

    beforeEach(() => {
      (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(svc30);
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'booking_1' });
    });

    it('reprograma: nueva fecha/hora con endTime recalculado, scoped por negocio', async () => {
      const res = await request(app)
        .patch('/api/bookings/booking_1')
        .send({ date: '2026-01-05', startTime: '15:00' });

      expect(res.status).toBe(200);
      expect(prisma.booking.findFirst).toHaveBeenCalledWith({ where: { id: 'booking_1', businessId: 'biz_1' } });
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking_1', businessId: 'biz_1' },
          data: expect.objectContaining({
            date: new Date('2026-01-05'),
            startTime: '15:00',
            endTime: '15:30',
            professionalId: 'prof_1',
          }),
        })
      );
    });

    it('valida conflictos con el mismo advisory lock que el alta y excluye a la propia reserva', async () => {
      await request(app).patch('/api/bookings/booking_1').send({ startTime: '10:15' });

      const lockCalls = (prisma.$executeRaw as ReturnType<typeof vi.fn>).mock.calls;
      expect(lockCalls[0][1]).toBe('booking:biz_1:prof_1:2026-01-01');
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ businessId: 'biz_1', professionalId: 'prof_1', id: { not: 'booking_1' } }),
        })
      );
      expect(prisma.booking.update).toHaveBeenCalled();
    });

    it('rechaza (409) si el nuevo horario se solapa con otro turno del profesional', async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ startTime: '15:00', endTime: '15:30' }]);

      const res = await request(app).patch('/api/bookings/booking_1').send({ startTime: '15:00' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/ya está reservado/);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('al cambiar el servicio recalcula endTime con su duración y actualiza el precio', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_2', duration: 60, price: 2500 });

      await request(app).patch('/api/bookings/booking_1').send({ serviceId: 'svc_2' });

      expect(prisma.service.findFirst).toHaveBeenCalledWith({ where: { id: 'svc_2', businessId: 'biz_1' } });
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ serviceId: 'svc_2', endTime: '11:00', totalPrice: 2500 }),
        })
      );
    });

    it('devuelve 404 si la reserva es de otro negocio (anti cross-tenant)', async () => {
      (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).patch('/api/bookings/de_otro').send({ startTime: '15:00' });

      expect(res.status).toBe(404);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('rechaza (404) un servicio de otro negocio', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).patch('/api/bookings/booking_1').send({ serviceId: 'svc_ajeno' });

      expect(res.status).toBe(404);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('rechaza (404) un profesional de otro negocio', async () => {
      (prisma.professional.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).patch('/api/bookings/booking_1').send({ professionalId: 'prof_ajeno' });

      expect(res.status).toBe(404);
      expect(prisma.professional.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prof_ajeno', businessId: 'biz_1' } })
      );
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('no deja editar una reserva cancelada (409)', async () => {
      (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existing, status: 'CANCELLED' });

      const res = await request(app).patch('/api/bookings/booking_1').send({ startTime: '15:00' });

      expect(res.status).toBe(409);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('notes vacío borra las notas (null) y no pisa el resto de los campos', async () => {
      await request(app).patch('/api/bookings/booking_1').send({ notes: '' });

      const data = (prisma.booking.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
      expect(data).toEqual({ notes: null });
    });

    it('una edición solo de notas NO recalcula endTime ni chequea conflictos (sin lock)', async () => {
      // Aunque el servicio hoy durara distinto, las notas no mueven la agenda.
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 90, price: 1000 });

      const res = await request(app).patch('/api/bookings/booking_1').send({ notes: 'nueva nota' });

      expect(res.status).toBe(200);
      const data = (prisma.booking.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
      expect(data).toEqual({ notes: 'nueva nota' });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
      expect(prisma.service.findFirst).not.toHaveBeenCalled();
    });

    it('solo notas sobre una reserva que pasó a final entre la lectura y el guardado => 409', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('x'), { code: 'P2025' }));

      const res = await request(app).patch('/api/bookings/booking_1').send({ notes: 'tarde' });

      expect(res.status).toBe(409);
    });

    it('relee el estado DENTRO del lock: si se canceló mientras tanto, no aplica la edición (409)', async () => {
      // 1ª lectura (afuera): CONFIRMED. 2ª lectura (dentro de la transacción): CANCELLED.
      (prisma.booking.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ status: 'CANCELLED' });

      const res = await request(app).patch('/api/bookings/booking_1').send({ startTime: '15:00' });

      expect(res.status).toBe(409);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('rechaza (409) pasarse a un servicio inactivo, pero no bloquea editar un turno de un servicio ya desactivado', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_2', duration: 30, price: 1, isActive: false });
      const toInactive = await request(app).patch('/api/bookings/booking_1').send({ serviceId: 'svc_2' });
      expect(toInactive.status).toBe(409);

      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1, isActive: false });
      const sameService = await request(app).patch('/api/bookings/booking_1').send({ startTime: '15:00' });
      expect(sameService.status).toBe(200);
    });

    it('rechaza (400) una edición que cruzaría la medianoche', async () => {
      (prisma.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'svc_1', duration: 120, price: 1 });

      const res = await request(app).patch('/api/bookings/booking_1').send({ startTime: '23:00' });

      expect(res.status).toBe(400);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('devuelve 400 con body vacío o con hora inválida', async () => {
      const empty = await request(app).patch('/api/bookings/booking_1').send({});
      const bad = await request(app).patch('/api/bookings/booking_1').send({ startTime: '3pm' });

      expect(empty.status).toBe(400);
      expect(bad.status).toBe(400);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('un CLIENT no puede reprogramar (403)', async () => {
      const res = await request(app)
        .patch('/api/bookings/booking_1')
        .set('x-test-role', 'CLIENT')
        .send({ startTime: '15:00' });

      expect(res.status).toBe(403);
      expect(prisma.booking.update).not.toHaveBeenCalled();
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

    it('un PROFESSIONAL puede cambiar el estado', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'booking_1', status: 'COMPLETED' });

      const res = await request(app)
        .patch('/api/bookings/booking_1/status')
        .set('x-test-role', 'PROFESSIONAL')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
    });

    it('un CLIENT no puede cambiar el estado de ninguna reserva (403), ni siquiera cancelar', async () => {
      const res = await request(app)
        .patch('/api/bookings/booking_1/status')
        .set('x-test-role', 'CLIENT')
        .send({ status: 'CANCELLED' });

      expect(res.status).toBe(403);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('no reabre una reserva en estado final: el UPDATE exige un estado no final', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'booking_1', status: 'PENDING' });

      await request(app).patch('/api/bookings/booking_1/status').send({ status: 'PENDING' });

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking_1', businessId: 'biz_1', status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] } },
        })
      );
    });

    it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'])('reabrir una reserva %s => 409 con mensaje claro', async (current) => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('no row'), { code: 'P2025' }));
      (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: current });

      const res = await request(app).patch('/api/bookings/booking_1/status').send({ status: 'PENDING' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cancelada, completada o ausente/);
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'booking_1', businessId: 'biz_1' } })
      );
    });

    it('una reserva inexistente (o de otro negocio) => 404, no 409', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('no row'), { code: 'P2025' }));
      (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).patch('/api/bookings/de-otro/status').send({ status: 'CONFIRMED' });

      expect(res.status).toBe(404);
    });

    it('las transiciones normales siguen igual (PENDING a IN_PROGRESS)', async () => {
      (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'booking_1', status: 'IN_PROGRESS' });

      const res = await request(app).patch('/api/bookings/booking_1/status').send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(200);
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
