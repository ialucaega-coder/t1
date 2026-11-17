/**
 * Pruebas de integracion para las rutas de plantillas
 * (`src/routes/templates.ts`): listar (scope por businessId + filtro por tipo),
 * crear (201 + validacion 400 con Zod), actualizar parcial (200 + 404) y
 * eliminar (204 + 404).
 *
 * Se mockean Prisma y el middleware de auth (requireAuth + requireRole).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    template: {
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
import { templatesRouter } from '../../routes/templates';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', templatesRouter);
  app.use(errorHandler);
  return app;
}

const templateRow = {
  id: 'tpl_1',
  name: 'Bienvenida',
  description: null,
  content: 'Hola {nombre}',
  category: null,
  type: 'whatsapp',
  businessId: 'biz_1',
};

describe('routes/templates', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/templates', () => {
    it('lista las plantillas del negocio (scope por businessId)', async () => {
      mock(prisma.template.findMany).mockResolvedValue([templateRow]);

      const res = await request(app).get('/api/templates');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(prisma.template.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1' } })
      );
    });

    it('filtra por tipo cuando se pasa el query param type', async () => {
      mock(prisma.template.findMany).mockResolvedValue([]);

      await request(app).get('/api/templates').query({ type: 'business' });

      expect(prisma.template.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', type: 'business' } })
      );
    });
  });

  describe('POST /api/templates', () => {
    const validPayload = { name: 'Bienvenida', content: 'Hola {nombre}', type: 'whatsapp' };

    it('crea una plantilla (201) con scope por businessId', async () => {
      mock(prisma.template.create).mockResolvedValue(templateRow);

      const res = await request(app).post('/api/templates').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.template.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Bienvenida',
            content: 'Hola {nombre}',
            type: 'whatsapp',
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 400 cuando falta el content (validacion Zod)', async () => {
      const res = await request(app).post('/api/templates').send({ name: 'X', type: 'whatsapp' });

      expect(res.status).toBe(400);
      expect(prisma.template.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un type fuera del enum permitido', async () => {
      const res = await request(app)
        .post('/api/templates')
        .send({ name: 'X', content: 'hola', type: 'email' });

      expect(res.status).toBe(400);
      expect(prisma.template.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/templates/:id', () => {
    it('actualiza una plantilla existente del negocio', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(templateRow);
      mock(prisma.template.update).mockResolvedValue({ ...templateRow, name: 'Editada' });

      const res = await request(app).patch('/api/templates/tpl_1').send({ name: 'Editada' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Editada' });
      expect(prisma.template.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl_1', businessId: 'biz_1' } })
      );
      expect(prisma.template.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl_1' }, data: expect.objectContaining({ name: 'Editada' }) })
      );
    });

    it('devuelve 404 si la plantilla no existe o es de otro negocio', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(null);

      const res = await request(app).patch('/api/templates/no-existe').send({ name: 'Editada' });

      expect(res.status).toBe(404);
      expect(prisma.template.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/templates/:id', () => {
    it('elimina la plantilla existente (204)', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(templateRow);
      mock(prisma.template.delete).mockResolvedValue({});

      const res = await request(app).delete('/api/templates/tpl_1');

      expect(res.status).toBe(204);
      expect(prisma.template.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl_1' } })
      );
    });

    it('devuelve 404 si la plantilla no existe', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(null);

      const res = await request(app).delete('/api/templates/no-existe');

      expect(res.status).toBe(404);
      expect(prisma.template.delete).not.toHaveBeenCalled();
    });
  });
});
