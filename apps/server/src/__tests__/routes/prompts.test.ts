/**
 * Pruebas de integracion para las rutas de prompts
 * (`src/routes/prompts.ts`). Los prompts se persisten en el modelo generico
 * `Template` (type='prompt') y el estado activo/inactivo se codifica dentro del
 * campo `category` (ej: "General [active]").
 *
 * Cubre: listar con seed de defaults (scope por businessId), crear (201 +
 * validacion 400 con Zod, solo ADMIN), actualizar parcial (200 + 404) y
 * eliminar (200 + 404).
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
      count: vi.fn(),
      createMany: vi.fn(),
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
import { promptsRouter } from '../../routes/prompts';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/prompts', promptsRouter);
  app.use(errorHandler);
  return app;
}

const promptRow = {
  id: 'prm_1',
  name: 'Saludo inicial',
  category: 'General [active]',
  content: 'Hola, bienvenido',
  type: 'prompt',
};

describe('routes/prompts', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/prompts', () => {
    it('lista los prompts del negocio mapeando el estado (scope por businessId)', async () => {
      mock(prisma.template.count).mockResolvedValue(1); // ya existen: no siembra defaults
      mock(prisma.template.findMany).mockResolvedValue([promptRow]);

      const res = await request(app).get('/api/prompts');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: 'prm_1',
        name: 'Saludo inicial',
        category: 'General',
        isActive: true,
      });
      expect(prisma.template.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', type: 'prompt' } })
      );
      expect(prisma.template.createMany).not.toHaveBeenCalled();
    });

    it('siembra los prompts por defecto cuando el negocio no tiene ninguno', async () => {
      mock(prisma.template.count).mockResolvedValue(0);
      mock(prisma.template.createMany).mockResolvedValue({ count: 4 });
      mock(prisma.template.findMany).mockResolvedValue([]);

      const res = await request(app).get('/api/prompts');

      expect(res.status).toBe(200);
      expect(prisma.template.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ businessId: 'biz_1', type: 'prompt' }),
          ]),
        })
      );
    });
  });

  describe('POST /api/prompts', () => {
    it('crea un prompt (201) codificando el estado en category', async () => {
      mock(prisma.template.create).mockResolvedValue({
        ...promptRow,
        category: 'Reservas [inactive]',
      });

      const res = await request(app)
        .post('/api/prompts')
        .send({ name: 'Nuevo', content: 'texto', category: 'Reservas', isActive: false });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ category: 'Reservas', isActive: false });
      expect(prisma.template.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz_1',
            type: 'prompt',
            name: 'Nuevo',
            category: 'Reservas [inactive]',
          }),
        })
      );
    });

    it('devuelve 400 cuando falta el content (validacion Zod)', async () => {
      const res = await request(app).post('/api/prompts').send({ name: 'Sin contenido' });

      expect(res.status).toBe(400);
      expect(prisma.template.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/prompts/:id', () => {
    it('actualiza un prompt existente del negocio (200)', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(promptRow);
      mock(prisma.template.update).mockResolvedValue({ ...promptRow, name: 'Editado' });

      const res = await request(app).put('/api/prompts/prm_1').send({ name: 'Editado' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Editado' });
      expect(prisma.template.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prm_1', businessId: 'biz_1', type: 'prompt' } })
      );
      expect(prisma.template.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prm_1' } })
      );
    });

    it('devuelve 404 si el prompt no existe o es de otro negocio', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(null);

      const res = await request(app).put('/api/prompts/no-existe').send({ name: 'Editado' });

      expect(res.status).toBe(404);
      expect(prisma.template.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/prompts/:id', () => {
    it('elimina el prompt existente y devuelve success', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(promptRow);
      mock(prisma.template.delete).mockResolvedValue({});

      const res = await request(app).delete('/api/prompts/prm_1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(prisma.template.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prm_1' } })
      );
    });

    it('devuelve 404 si el prompt no existe', async () => {
      mock(prisma.template.findFirst).mockResolvedValue(null);

      const res = await request(app).delete('/api/prompts/no-existe');

      expect(res.status).toBe(404);
      expect(prisma.template.delete).not.toHaveBeenCalled();
    });
  });
});
