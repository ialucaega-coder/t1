/**
 * Pruebas de integracion para las rutas de comandos
 * (`src/routes/commands.ts`): listado de comandos del negocio agrupados por
 * categoria, con auto-sembrado (seed) del catalogo por defecto la primera vez.
 *
 * Todo esta scopeado por `businessId` (multi-tenant). Se mockean Prisma y el
 * middleware de auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    command: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
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
import { commandsRouter } from '../../routes/commands';
import { errorHandler } from '../../middleware/errorHandler';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/commands', commandsRouter);
  app.use(errorHandler);
  return app;
}

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('routes/commands', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/commands', () => {
    it('devuelve los comandos del negocio agrupados por categoria', async () => {
      // Ya existen comandos: no se siembra el catalogo por defecto.
      mock(prisma.command.count).mockResolvedValue(3);
      mock(prisma.command.findMany).mockResolvedValue([
        { name: '/ver-agenda', description: 'Ver la agenda', template: '/ver-agenda', category: 'Reservas' },
        { name: '/nueva-reserva', description: 'Crear reserva', template: '/nueva-reserva', category: 'Reservas' },
        { name: '/estado', description: 'Estado del bot', template: '/estado', category: 'Sistema' },
      ]);

      const res = await request(app).get('/api/commands');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2); // dos categorias: Reservas y Sistema
      const reservas = (res.body as { category: string; items: unknown[] }[]).find((g) => g.category === 'Reservas');
      expect(reservas?.items).toHaveLength(2);
      expect(reservas?.items[0]).toEqual({ name: '/ver-agenda', desc: 'Ver la agenda' });
      // El listado esta scopeado por el negocio del token.
      expect(prisma.command.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
      // No se sembro porque ya habia comandos.
      expect(prisma.command.createMany).not.toHaveBeenCalled();
    });

    it('usa el template como fallback cuando la descripcion es null', async () => {
      mock(prisma.command.count).mockResolvedValue(1);
      mock(prisma.command.findMany).mockResolvedValue([
        { name: '/backup', description: null, template: '/backup', category: 'Sistema' },
      ]);

      const res = await request(app).get('/api/commands');

      expect(res.status).toBe(200);
      expect(res.body[0].items[0]).toEqual({ name: '/backup', desc: '/backup' });
    });

    it('agrupa bajo "General" cuando la categoria es null', async () => {
      mock(prisma.command.count).mockResolvedValue(1);
      mock(prisma.command.findMany).mockResolvedValue([
        { name: '/x', description: 'X', template: '/x', category: null },
      ]);

      const res = await request(app).get('/api/commands');

      expect(res.status).toBe(200);
      expect(res.body[0].category).toBe('General');
    });

    it('siembra el catalogo por defecto la primera vez (count === 0)', async () => {
      mock(prisma.command.count).mockResolvedValue(0);
      mock(prisma.command.createMany).mockResolvedValue({ count: 28 });
      mock(prisma.command.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/commands');

      expect(res.status).toBe(200);
      expect(prisma.command.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ businessId: 'biz_1' }),
          ]),
        })
      );
    });

    it('devuelve 500 si Prisma falla', async () => {
      mock(prisma.command.count).mockRejectedValue(new Error('db error'));

      const res = await request(app).get('/api/commands');

      expect(res.status).toBe(500);
    });
  });
});
