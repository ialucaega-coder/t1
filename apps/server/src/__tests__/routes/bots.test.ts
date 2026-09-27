/**
 * Pruebas de integracion para las rutas de bots
 * (`src/routes/bots.ts`): CRUD por negocio (listar, leer, crear, actualizar,
 * eliminar) y listado de conversaciones de un bot.
 *
 * Todas las rutas estan scopeadas por `businessId` (multi-tenant) y las
 * mutaciones exigen rol ADMIN. Se mockean Prisma y el middleware de auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    bot: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
      count: vi.fn(),
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
import { botsRouter } from '../../routes/bots';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bots', botsRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/bots', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/bots', () => {
    it('devuelve la lista paginada de bots del negocio', async () => {
      mock(prisma.bot.findMany).mockResolvedValue([{ id: 'bot_1', name: 'Recepcion' }]);
      mock(prisma.bot.count).mockResolvedValue(1);

      const res = await request(app).get('/api/bots');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(prisma.bot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });

    it('respeta la paginacion (page/pageSize) con skip/take', async () => {
      mock(prisma.bot.findMany).mockResolvedValue([]);
      mock(prisma.bot.count).mockResolvedValue(30);

      const res = await request(app).get('/api/bots').query({ page: '2', pageSize: '10' });

      expect(res.body).toMatchObject({ page: 2, pageSize: 10, total: 30 });
      expect(prisma.bot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });
  });

  describe('GET /api/bots/:id', () => {
    it('devuelve el bot del negocio cuando existe', async () => {
      mock(prisma.bot.findFirst).mockResolvedValue({ id: 'bot_1', name: 'Recepcion' });

      const res = await request(app).get('/api/bots/bot_1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('bot_1');
      expect(prisma.bot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'bot_1', businessId: 'biz_1' }) })
      );
    });

    it('devuelve 404 cuando el bot no existe (o es de otro negocio)', async () => {
      mock(prisma.bot.findFirst).mockResolvedValue(null);

      const res = await request(app).get('/api/bots/no-existe');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/bots', () => {
    it('crea un bot con datos validos (201) inyectando el businessId', async () => {
      mock(prisma.bot.create).mockResolvedValue({ id: 'bot_1', name: 'Ventas' });

      const res = await request(app)
        .post('/api/bots')
        .send({ name: 'Ventas', channel: 'WHATSAPP' });

      expect(res.status).toBe(201);
      expect(prisma.bot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Ventas', channel: 'WHATSAPP', businessId: 'biz_1' }),
        })
      );
    });

    it('aplica el canal por defecto (TELEGRAM) cuando no se envia', async () => {
      mock(prisma.bot.create).mockResolvedValue({ id: 'bot_1' });

      await request(app).post('/api/bots').send({ name: 'Sin canal' });

      expect(prisma.bot.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channel: 'TELEGRAM' }) })
      );
    });

    it('devuelve 400 cuando falta el nombre', async () => {
      const res = await request(app).post('/api/bots').send({ channel: 'WEB' });

      expect(res.status).toBe(400);
      expect(prisma.bot.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un canal invalido', async () => {
      const res = await request(app).post('/api/bots').send({ name: 'X', channel: 'SIGNAL' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/bots/:id', () => {
    it('actualiza el bot y devuelve la version fresca', async () => {
      mock(prisma.bot.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.bot.findUnique).mockResolvedValue({ id: 'bot_1', status: 'ACTIVE' });

      const res = await request(app).patch('/api/bots/bot_1').send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(prisma.bot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bot_1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 cuando el update no afecta filas (bot inexistente)', async () => {
      mock(prisma.bot.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app).patch('/api/bots/no-existe').send({ status: 'PAUSED' });

      expect(res.status).toBe(404);
      expect(prisma.bot.findUnique).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un status invalido', async () => {
      const res = await request(app).patch('/api/bots/bot_1').send({ status: 'FROZEN' });

      expect(res.status).toBe(400);
      expect(prisma.bot.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/bots/:id', () => {
    it('elimina el bot del negocio (204)', async () => {
      mock(prisma.bot.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/bots/bot_1');

      expect(res.status).toBe(204);
      expect(prisma.bot.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bot_1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 cuando no hay nada que borrar', async () => {
      mock(prisma.bot.deleteMany).mockResolvedValue({ count: 0 });

      const res = await request(app).delete('/api/bots/no-existe');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/bots/:id/conversations', () => {
    it('lista las conversaciones del bot scopeadas por negocio', async () => {
      mock(prisma.conversation.findMany).mockResolvedValue([{ id: 'c1' }]);
      mock(prisma.conversation.count).mockResolvedValue(1);

      const res = await request(app).get('/api/bots/bot_1/conversations');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { botId: 'bot_1', businessId: 'biz_1' } })
      );
    });
  });
});
