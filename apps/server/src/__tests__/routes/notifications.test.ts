/**
 * Pruebas de integracion para las rutas de notificaciones
 * (`src/routes/notifications.ts`): listado paginado, conteo de no leidas,
 * creacion, y marcado como leidas (una o todas).
 *
 * Se mockea Prisma y se usa el middleware de auth real con JWT firmado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';
import { notificationsRouter } from '../../routes/notifications';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/notifications', () => {
  const app = buildApp();
  const token = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/notifications', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    it('devuelve la lista paginada con conteo de no leidas', async () => {
      mock(prisma.notification.findMany).mockResolvedValue([{ id: 'n1', isRead: false }]);
      // count se invoca dos veces (total y unreadCount) via Promise.all
      mock(prisma.notification.count).mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, unreadCount: 1, page: 1, pageSize: 20, totalPages: 1 });
      expect(res.body.data).toHaveLength(1);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', userId: 'user_1' } })
      );
    });

    it('filtra solo no leidas con unreadOnly=true', async () => {
      mock(prisma.notification.findMany).mockResolvedValue([]);
      mock(prisma.notification.count).mockResolvedValue(0);

      await request(app)
        .get('/api/notifications')
        .query({ unreadOnly: 'true' })
        .set('Authorization', `Bearer ${token}`);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isRead: false }) })
      );
    });

    it('respeta paginacion (page y pageSize) con skip/take', async () => {
      mock(prisma.notification.findMany).mockResolvedValue([]);
      mock(prisma.notification.count).mockResolvedValue(0);

      await request(app)
        .get('/api/notifications')
        .query({ page: '3', pageSize: '10' })
        .set('Authorization', `Bearer ${token}`);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('devuelve el conteo de no leidas', async () => {
      mock(prisma.notification.count).mockResolvedValue(5);

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadCount: 5 });
    });
  });

  describe('POST /api/notifications', () => {
    const validPayload = {
      type: 'GENERAL',
      channel: 'PUSH',
      title: 'Hola',
      body: 'Mensaje',
      userId: 'user_1',
    };

    it('crea una notificacion con datos validos', async () => {
      mock(prisma.notification.create).mockResolvedValue({ id: 'n1', ...validPayload });

      const res = await request(app)
        .post('/api/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ businessId: 'biz_1', title: 'Hola' }) })
      );
    });

    it('devuelve 400 cuando faltan campos requeridos', async () => {
      const res = await request(app)
        .post('/api/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Solo titulo' });

      expect(res.status).toBe(400);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un type o channel invalido', async () => {
      const res = await request(app)
        .post('/api/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validPayload, type: 'NO_EXISTE' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/notifications/read-all', () => {
    it('marca todas como leidas', async () => {
      mock(prisma.notification.updateMany).mockResolvedValue({ count: 3 });

      const res = await request(app)
        .put('/api/notifications/read-all')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user_1', businessId: 'biz_1', isRead: false },
          data: { isRead: true },
        })
      );
    });
  });

  describe('PUT /api/notifications/:id/read', () => {
    it('marca una notificacion como leida', async () => {
      mock(prisma.notification.update).mockResolvedValue({ id: 'n1', isRead: true });

      const res = await request(app)
        .put('/api/notifications/n1/read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.isRead).toBe(true);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1', businessId: 'biz_1' }, data: { isRead: true } })
      );
    });

    it('el alias PATCH /:id/read tambien funciona', async () => {
      mock(prisma.notification.update).mockResolvedValue({ id: 'n1', isRead: true });

      const res = await request(app)
        .patch('/api/notifications/n1/read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });
});
