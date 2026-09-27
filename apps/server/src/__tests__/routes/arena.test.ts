/**
 * Pruebas de integracion para las rutas de arena
 * (`src/routes/arena.ts`): builders (CRUD con scope por negocio),
 * ideas (listar/crear/votar) y el endpoint de chat de prueba.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth setea req.auth;
 * requireRole chequea el rol).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    arenaBuilder: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    arenaIdea: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
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
import { arenaRouter } from '../../routes/arena';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/arena', arenaRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/arena', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/arena/builders', () => {
    it('devuelve los builders del negocio (scope por businessId)', async () => {
      mock(prisma.arenaBuilder.findMany).mockResolvedValue([{ id: 'b1', name: 'Bot 1' }]);

      const res = await request(app).get('/api/arena/builders');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.arenaBuilder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });
  });

  describe('POST /api/arena/builders', () => {
    it('crea un builder con defaults (201) inyectando el businessId del auth', async () => {
      mock(prisma.arenaBuilder.create).mockResolvedValue({ id: 'b1', name: 'Bot 1' });

      const res = await request(app).post('/api/arena/builders').send({ name: 'Bot 1' });

      expect(res.status).toBe(201);
      expect(prisma.arenaBuilder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Bot 1',
            systemPrompt: '',
            model: 'claude-sonnet-5',
            temperature: 0.7,
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 400 cuando falta el nombre (validacion Zod)', async () => {
      const res = await request(app).post('/api/arena/builders').send({ description: 'sin nombre' });

      expect(res.status).toBe(400);
      expect(prisma.arenaBuilder.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando temperature esta fuera de rango', async () => {
      const res = await request(app)
        .post('/api/arena/builders')
        .send({ name: 'Bot', temperature: 5 });

      expect(res.status).toBe(400);
      expect(prisma.arenaBuilder.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/arena/builders/:id', () => {
    it('actualiza el builder cuando pertenece al negocio', async () => {
      mock(prisma.arenaBuilder.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.arenaBuilder.findFirst).mockResolvedValue({ id: 'b1', name: 'Nuevo' });

      const res = await request(app).patch('/api/arena/builders/b1').send({ name: 'Nuevo' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'b1' });
      expect(prisma.arenaBuilder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 si el builder no pertenece al negocio (anti cross-tenant)', async () => {
      mock(prisma.arenaBuilder.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app)
        .patch('/api/arena/builders/de-otro-negocio')
        .send({ name: 'Nuevo' });

      expect(res.status).toBe(404);
      expect(prisma.arenaBuilder.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/arena/builders/:id', () => {
    it('elimina el builder cuando pertenece al negocio (204)', async () => {
      mock(prisma.arenaBuilder.deleteMany).mockResolvedValue({ count: 1 });

      const res = await request(app).delete('/api/arena/builders/b1');

      expect(res.status).toBe(204);
      expect(prisma.arenaBuilder.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b1', businessId: 'biz_1' } })
      );
    });

    it('devuelve 404 si el builder no pertenece al negocio', async () => {
      mock(prisma.arenaBuilder.deleteMany).mockResolvedValue({ count: 0 });

      const res = await request(app).delete('/api/arena/builders/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/arena/ideas', () => {
    it('devuelve las ideas del negocio ordenadas por votos', async () => {
      mock(prisma.arenaIdea.findMany).mockResolvedValue([{ id: 'i1', title: 'Idea' }]);

      const res = await request(app).get('/api/arena/ideas');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.arenaIdea.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1' },
          orderBy: { votes: 'desc' },
        })
      );
    });
  });

  describe('POST /api/arena/ideas', () => {
    it('crea una idea con categoria por defecto (201)', async () => {
      mock(prisma.arenaIdea.create).mockResolvedValue({ id: 'i1', title: 'Idea' });

      const res = await request(app).post('/api/arena/ideas').send({ title: 'Idea' });

      expect(res.status).toBe(201);
      expect(prisma.arenaIdea.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Idea',
            category: 'general',
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 400 cuando falta el titulo (validacion Zod)', async () => {
      const res = await request(app).post('/api/arena/ideas').send({ description: 'sin titulo' });

      expect(res.status).toBe(400);
      expect(prisma.arenaIdea.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/arena/ideas/:id/vote', () => {
    it('incrementa los votos cuando la idea pertenece al negocio', async () => {
      mock(prisma.arenaIdea.updateMany).mockResolvedValue({ count: 1 });
      mock(prisma.arenaIdea.findFirst).mockResolvedValue({ id: 'i1', votes: 2 });

      const res = await request(app).post('/api/arena/ideas/i1/vote');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'i1', votes: 2 });
      expect(prisma.arenaIdea.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'i1', businessId: 'biz_1' },
          data: { votes: { increment: 1 } },
        })
      );
    });

    it('devuelve 404 si la idea no pertenece al negocio (anti cross-tenant)', async () => {
      mock(prisma.arenaIdea.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app).post('/api/arena/ideas/de-otro-negocio/vote');

      expect(res.status).toBe(404);
      expect(prisma.arenaIdea.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/arena/chat', () => {
    it('devuelve una respuesta de prueba con el mensaje enviado (200)', async () => {
      const res = await request(app)
        .post('/api/arena/chat')
        .send({ message: 'hola', builderId: 'b1' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        tokens: { input: 8, output: 50 },
      });
      expect(res.body.response).toContain('hola');
      expect(res.body.response).toContain('b1');
    });

    it('devuelve 400 cuando falta el mensaje (validacion Zod)', async () => {
      const res = await request(app).post('/api/arena/chat').send({ builderId: 'b1' });

      expect(res.status).toBe(400);
    });
  });
});
