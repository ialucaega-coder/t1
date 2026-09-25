/**
 * Pruebas de integracion para las rutas de Telegram (`src/routes/telegram.ts`):
 * webhook publico, connect, disconnect y status.
 *
 * Se mockean Prisma y la capa de servicio `services/telegram/bot` (que envuelve
 * a grammy): estas pruebas no hablan con Telegram ni con una DB real.
 * El middleware de auth es el real, y se firman JWT con NEXTAUTH_SECRET para
 * probar 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../services/telegram/bot', () => ({
  createBot: vi.fn(),
  stopBot: vi.fn(),
  setWebhook: vi.fn(),
  handleUpdate: vi.fn(),
  getBotInfo: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { createBot, stopBot, setWebhook, handleUpdate, getBotInfo } from '../../services/telegram/bot';
import { telegramRouter } from '../../routes/telegram';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telegram', telegramRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/telegram', () => {
  const app = buildApp();
  const adminToken = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/telegram/webhook/:businessId', () => {
    it('responde 200 y no procesa si no existe conexion activa', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/telegram/webhook/biz_1')
        .query({ token: 'cualquier' })
        .send({ update_id: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(handleUpdate).not.toHaveBeenCalled();
    });

    it('devuelve 403 si el token del webhook no coincide con el almacenado', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        id: 'conn_1',
        businessId: 'biz_1',
        type: 'TELEGRAM',
        isActive: true,
        config: { botToken: '123:ABCdef' },
      });

      const res = await request(app)
        .post('/api/telegram/webhook/biz_1')
        .query({ token: 'token-erroneo' })
        .send({ update_id: 1 });

      expect(res.status).toBe(403);
      expect(handleUpdate).not.toHaveBeenCalled();
    });

    it('procesa el update y responde 200 cuando el token coincide', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        id: 'conn_1',
        businessId: 'biz_1',
        type: 'TELEGRAM',
        isActive: true,
        config: { botToken: '123:ABCdef' },
      });
      mock(handleUpdate).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/telegram/webhook/biz_1')
        .query({ token: '123:ABCdef' })
        .send({ update_id: 42 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(handleUpdate).toHaveBeenCalledWith('biz_1', expect.objectContaining({ update_id: 42 }));
    });

    it('responde 200 aunque handleUpdate falle (no reintenta Telegram)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        id: 'conn_1',
        businessId: 'biz_1',
        type: 'TELEGRAM',
        isActive: true,
        config: { botToken: '123:ABCdef' },
      });
      mock(handleUpdate).mockRejectedValue(new Error('boom'));

      const res = await request(app)
        .post('/api/telegram/webhook/biz_1')
        .query({ token: '123:ABCdef' })
        .send({ update_id: 7 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('POST /api/telegram/connect', () => {
    it('devuelve 401 sin token de autenticacion', async () => {
      const res = await request(app).post('/api/telegram/connect').send({ botToken: '123:ABCdef' });

      expect(res.status).toBe(401);
      expect(createBot).not.toHaveBeenCalled();
    });

    it('devuelve 400 si no se envia botToken', async () => {
      const res = await request(app)
        .post('/api/telegram/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(createBot).not.toHaveBeenCalled();
    });

    it('devuelve 400 si el formato del token es invalido', async () => {
      const res = await request(app)
        .post('/api/telegram/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ botToken: 'token-sin-formato' });

      expect(res.status).toBe(400);
      expect(createBot).not.toHaveBeenCalled();
    });

    it('conecta el bot y crea la conexion cuando no existe', async () => {
      mock(createBot).mockResolvedValue({ botInfo: { username: 'localb_bot', first_name: 'Local B' } });
      mock(setWebhook).mockResolvedValue(undefined);
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });

      const res = await request(app)
        .post('/api/telegram/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ botToken: '123456789:ABCdefGHIjkl' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        bot: { username: 'localb_bot', name: 'Local B' },
      });
      expect(res.body.webhookUrl).toContain('/api/telegram/webhook/biz_1');
      expect(createBot).toHaveBeenCalledWith('123456789:ABCdefGHIjkl', 'biz_1');
      expect(prisma.connection.create).toHaveBeenCalled();
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('actualiza la conexion existente en vez de crear una nueva', async () => {
      mock(createBot).mockResolvedValue({ botInfo: { username: 'localb_bot', first_name: 'Local B' } });
      mock(setWebhook).mockResolvedValue(undefined);
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1', businessId: 'biz_1' });
      mock(prisma.connection.update).mockResolvedValue({ id: 'conn_1' });

      const res = await request(app)
        .post('/api/telegram/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ botToken: '123456789:ABCdefGHIjkl' });

      expect(res.status).toBe(200);
      expect(prisma.connection.update).toHaveBeenCalled();
      expect(prisma.connection.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 si el token es rechazado por Telegram (createBot lanza)', async () => {
      mock(createBot).mockRejectedValue(new Error('unauthorized'));

      const res = await request(app)
        .post('/api/telegram/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ botToken: '123456789:ABCdefGHIjkl' });

      expect(res.status).toBe(400);
      expect(setWebhook).not.toHaveBeenCalled();
    });

    it('devuelve 500 y detiene el bot si falla la configuracion del webhook', async () => {
      mock(createBot).mockResolvedValue({ botInfo: { username: 'localb_bot', first_name: 'Local B' } });
      mock(setWebhook).mockRejectedValue(new Error('webhook no accesible'));
      mock(stopBot).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/telegram/connect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ botToken: '123456789:ABCdefGHIjkl' });

      expect(res.status).toBe(500);
      expect(stopBot).toHaveBeenCalledWith('biz_1');
    });
  });

  describe('DELETE /api/telegram/disconnect', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).delete('/api/telegram/disconnect');
      expect(res.status).toBe(401);
    });

    it('detiene el bot y desactiva la conexion existente', async () => {
      mock(stopBot).mockResolvedValue(undefined);
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1', businessId: 'biz_1' });
      mock(prisma.connection.update).mockResolvedValue({ id: 'conn_1', isActive: false });

      const res = await request(app)
        .delete('/api/telegram/disconnect')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(stopBot).toHaveBeenCalledWith('biz_1');
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conn_1' }, data: { isActive: false, config: {} } })
      );
    });

    it('responde ok aunque no haya conexion en la DB', async () => {
      mock(stopBot).mockResolvedValue(undefined);
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/telegram/disconnect')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/telegram/status', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/telegram/status');
      expect(res.status).toBe(401);
    });

    it('devuelve connected:false si no hay conexion', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/telegram/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ connected: false, bot: null });
    });

    it('devuelve connected:false si la conexion esta inactiva', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1', isActive: false, config: {} });

      const res = await request(app)
        .get('/api/telegram/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });

    it('devuelve datos del bot cuando la conexion esta activa', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        id: 'conn_1',
        isActive: true,
        config: { botUsername: 'localb_bot', botName: 'Local B', connectedAt: '2026-01-01T00:00:00.000Z' },
      });
      mock(getBotInfo).mockReturnValue(null);

      const res = await request(app)
        .get('/api/telegram/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        connected: true,
        bot: { username: 'localb_bot', name: 'Local B', connectedAt: '2026-01-01T00:00:00.000Z' },
      });
    });
  });
});
