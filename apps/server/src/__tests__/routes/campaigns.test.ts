/**
 * Pruebas de integracion para las rutas de campanas (`src/routes/campaigns.ts`):
 * listado paginado, destinatarios, creacion (ADMIN), actualizacion, envio y
 * eliminacion.
 *
 * Se mockean Prisma y la capa de socket (`lib/socket`). Se usa el middleware de
 * auth real con JWT firmado para probar 401/403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    booking: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

// getIO se mockea para devolver undefined; la ruta usa optional chaining, asi
// que el emit se omite sin romper. Evita importar el server real de socket.io.
vi.mock('../../lib/socket', () => ({
  getIO: () => undefined,
}));

import { prisma } from '../../lib/prisma';
import { campaignsRouter } from '../../routes/campaigns';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(payload: { userId: string; businessId: string; role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' }) {
  return jwt.sign(payload, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', campaignsRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/campaigns', () => {
  const app = buildApp();
  const adminToken = signToken({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' });
  const clientToken = signToken({ userId: 'user_2', businessId: 'biz_1', role: 'CLIENT' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/campaigns', () => {
    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/campaigns');
      expect(res.status).toBe(401);
    });

    it('devuelve la lista paginada de campanas', async () => {
      mock(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1', name: 'Promo' }]);
      mock(prisma.campaign.count).mockResolvedValue(1);

      const res = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(res.body.data).toHaveLength(1);
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });
  });

  describe('GET /api/campaigns/recipients', () => {
    it('devuelve 0 destinatarios si no hay reservas', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/campaigns/recipients')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 0, recipients: [] });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('filtra destinatarios por canal email (requieren email)', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([{ clientId: 'u1' }, { clientId: 'u2' }]);
      mock(prisma.user.findMany).mockResolvedValue([
        { id: 'u1', name: 'Ana', email: 'ana@x.com', phone: null },
        { id: 'u2', name: 'Beto', email: null, phone: '123' },
      ]);

      const res = await request(app)
        .get('/api/campaigns/recipients')
        .query({ channel: 'email' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.recipients[0].id).toBe('u1');
    });

    it('filtra destinatarios por canal whatsapp (requieren phone)', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([{ clientId: 'u1' }, { clientId: 'u2' }]);
      mock(prisma.user.findMany).mockResolvedValue([
        { id: 'u1', name: 'Ana', email: 'ana@x.com', phone: null },
        { id: 'u2', name: 'Beto', email: null, phone: '123' },
      ]);

      const res = await request(app)
        .get('/api/campaigns/recipients')
        .query({ channel: 'whatsapp' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.total).toBe(1);
      expect(res.body.recipients[0].id).toBe('u2');
    });
  });

  describe('POST /api/campaigns', () => {
    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ name: 'Promo' });

      expect(res.status).toBe(403);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('crea una campana con datos validos', async () => {
      mock(prisma.campaign.create).mockResolvedValue({ id: 'c1', name: 'Promo' });

      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Promo', channel: 'email' });

      expect(res.status).toBe(201);
      expect(prisma.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Promo', channel: 'email', businessId: 'biz_1' }) })
      );
    });

    it('devuelve 400 cuando falta el nombre', async () => {
      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ channel: 'email' });

      expect(res.status).toBe(400);
    });

    it('devuelve 400 con un canal invalido', async () => {
      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Promo', channel: 'paloma-mensajera' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/campaigns/:id', () => {
    it('actualiza una campana existente', async () => {
      mock(prisma.campaign.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', name: 'Nuevo' });

      const res = await request(app)
        .patch('/api/campaigns/c1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Nuevo');
    });

    it('devuelve 404 si la campana no existe (o es de otro negocio)', async () => {
      mock(prisma.campaign.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app)
        .patch('/api/campaigns/no-existe')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(404);
      expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/campaigns/:id/send', () => {
    it('envia la campana y actualiza el conteo de destinatarios', async () => {
      mock(prisma.campaign.findFirst).mockResolvedValue({ id: 'c1', status: 'draft' });
      mock(prisma.booking.findMany).mockResolvedValue([{ clientId: 'u1' }, { clientId: 'u2' }]);
      mock(prisma.campaign.update).mockResolvedValue({ id: 'c1', status: 'sent', sentCount: 2 });

      const res = await request(app)
        .post('/api/campaigns/c1/send')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('sent');
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ status: 'sent', sentCount: 2 }) })
      );
    });

    it('devuelve 404 si la campana no existe', async () => {
      mock(prisma.campaign.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/campaigns/no-existe/send')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it('devuelve 400 si la campana ya fue enviada', async () => {
      mock(prisma.campaign.findFirst).mockResolvedValue({ id: 'c1', status: 'sent' });

      const res = await request(app)
        .post('/api/campaigns/c1/send')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/campaigns/:id', () => {
    it('elimina una campana existente', async () => {
      mock(prisma.campaign.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .delete('/api/campaigns/c1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });

    it('devuelve 404 si la campana no existe', async () => {
      mock(prisma.campaign.deleteMany).mockResolvedValue({ count: 0 });

      const res = await request(app)
        .delete('/api/campaigns/no-existe')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .delete('/api/campaigns/c1')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(prisma.campaign.deleteMany).not.toHaveBeenCalled();
    });
  });
});
