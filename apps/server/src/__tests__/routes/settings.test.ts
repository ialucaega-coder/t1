/**
 * Pruebas de integracion para las rutas de configuracion
 * (`src/routes/settings.ts`): lectura de settings del negocio (scope por
 * businessId) y actualizacion (200 + validacion 400). La configuracion de IA
 * ya no vive aca (se movio al Motor de IA real en /api/ai); ver ai.test.ts.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth + requireRole).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    connection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
import { settingsRouter } from '../../routes/settings';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use(errorHandler);
  return app;
}

const businessRow = {
  id: 'biz_1',
  name: 'Peluqueria Ana',
  slug: 'peluqueria-ana',
  phone: null,
  email: null,
  address: null,
  timezone: 'America/Argentina/Buenos_Aires',
  currency: 'ARS',
  theme: 'light',
  accentColor: '#3366FF',
};

describe('routes/settings', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/settings', () => {
    it('devuelve la configuracion mapeada del negocio (scope por businessId)', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(businessRow);

      const res = await request(app).get('/api/settings');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        businessName: 'Peluqueria Ana',
        slug: 'peluqueria-ana',
        currency: 'ARS',
      });
      expect(prisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'biz_1' } })
      );
    });

    it('devuelve 404 si el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);

      const res = await request(app).get('/api/settings');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/settings', () => {
    it('actualiza los settings del negocio (scope por businessId)', async () => {
      mock(prisma.business.update).mockResolvedValue({ ...businessRow, name: 'Nuevo Nombre' });

      const res = await request(app).put('/api/settings').send({ businessName: 'Nuevo Nombre' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ businessName: 'Nuevo Nombre' });
      expect(prisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'biz_1' },
          data: expect.objectContaining({ name: 'Nuevo Nombre' }),
        })
      );
    });

    it('devuelve 400 con un slug invalido (validacion Zod)', async () => {
      const res = await request(app).put('/api/settings').send({ slug: 'Slug Invalido!' });

      expect(res.status).toBe(400);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });
  });
});
