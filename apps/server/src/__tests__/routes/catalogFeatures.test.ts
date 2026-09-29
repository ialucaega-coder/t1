/**
 * Pruebas de integración de los endpoints CRUD genéricos del catálogo
 * (`src/routes/catalogFeatures.ts`) que NO están cubiertos por
 * `superpowers.test.ts` (que solo prueba los ganchos report/reminders/…):
 *   - GET  /            → lista, sembrando defaults y filtrando por kind
 *   - PUT  /:name       → actualiza (solo ADMIN), 404 si falta o es de otro kind
 *
 * Se prueba con el router de tipo 'skill'. Auth REAL (JWT); Prisma y la capa
 * de catálogo se mockean. `readFeatureConfig` se mockea como passthrough del
 * config crudo para poder controlar el kind por fila.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    skill: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../services/catalog', () => ({
  ensureDefaultFeatures: vi.fn().mockResolvedValue(undefined),
  readFeatureConfig: vi.fn((config) => (config && typeof config === 'object' ? config : {})),
}));

// Los ganchos de superpoder no se montan para 'skill', pero el módulo los importa.
vi.mock('../../services/superpowers/report', () => ({
  generateDailyReport: vi.fn(),
  generateReminders: vi.fn(),
}));
vi.mock('../../services/superpowers/analysis', () => ({
  analyzeConversation: vi.fn(),
  detectKnowledgeGaps: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { ensureDefaultFeatures } from '../../services/catalog';
import { createCatalogFeaturesRouter } from '../../routes/catalogFeatures';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const userToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'USER' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/skills', createCatalogFeaturesRouter('skill'));
  app.use(errorHandler);
  return app;
}

describe('routes/catalogFeatures (CRUD genérico, kind=skill)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(ensureDefaultFeatures).mockResolvedValue(undefined);
  });

  describe('GET /api/skills', () => {
    it('siembra defaults, filtra por kind y mapea las filas', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([
        {
          name: 'Reservas',
          description: 'Agenda',
          icon: 'Cal',
          isActive: true,
          config: { kind: 'skill', subtitle: 'Sub A', iconName: 'IconA' },
        },
        // Fila de otro kind: debe filtrarse.
        {
          name: 'Reportes',
          description: 'x',
          icon: 'Bar',
          isActive: true,
          config: { kind: 'superpower' },
        },
      ]);

      const res = await request(app).get('/api/skills').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(ensureDefaultFeatures).toHaveBeenCalledWith('biz_1', 'skill', expect.any(Array));
      expect(res.body).toEqual([
        { name: 'Reservas', subtitle: 'Sub A', description: 'Agenda', iconName: 'IconA', isActive: true },
      ]);
    });

    it('exige autenticación', async () => {
      const res = await request(app).get('/api/skills');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/skills/:name', () => {
    it('actualiza y devuelve la feature mapeada (ADMIN)', async () => {
      mock(prisma.skill.findFirst).mockResolvedValue({
        id: 'sk1',
        name: 'Reservas',
        icon: 'Cal',
        config: { kind: 'skill', subtitle: 'viejo', iconName: 'Old' },
      });
      mock(prisma.skill.update).mockResolvedValue({
        name: 'Reservas',
        description: 'Nueva desc',
        icon: 'NewIcon',
        isActive: false,
        config: { kind: 'skill', subtitle: 'viejo', iconName: 'NewIcon' },
      });

      const res = await request(app)
        .put('/api/skills/Reservas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'Nueva desc', iconName: 'NewIcon', isActive: false });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        name: 'Reservas',
        subtitle: 'viejo',
        description: 'Nueva desc',
        iconName: 'NewIcon',
        isActive: false,
      });
    });

    it('rechaza a un usuario sin rol ADMIN (403)', async () => {
      const res = await request(app)
        .put('/api/skills/Reservas')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ isActive: false });
      expect(res.status).toBe(403);
    });

    it('devuelve 404 cuando la feature no existe', async () => {
      mock(prisma.skill.findFirst).mockResolvedValue(null);
      const res = await request(app)
        .put('/api/skills/NoExiste')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });
      expect(res.status).toBe(404);
    });

    it('devuelve 404 cuando la fila existe pero es de otro kind', async () => {
      mock(prisma.skill.findFirst).mockResolvedValue({
        id: 'sp1',
        name: 'Reportes',
        icon: 'Bar',
        config: { kind: 'superpower' },
      });
      const res = await request(app)
        .put('/api/skills/Reportes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });
      expect(res.status).toBe(404);
      expect(prisma.skill.update).not.toHaveBeenCalled();
    });

    it('valida el body (isActive debe ser booleano) → 400', async () => {
      const res = await request(app)
        .put('/api/skills/Reservas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: 'sí' });
      expect(res.status).toBe(400);
    });
  });
});
