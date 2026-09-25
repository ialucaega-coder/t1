/**
 * Pruebas de integración para las plantillas por giro
 * (`src/routes/industryTemplates.ts`): GET lista las plantillas y
 * POST /:id/aplicar las aplica al negocio (idempotente, solo ADMIN).
 *
 * Auth REAL (JWT). Se mockea Prisma y la capa `services/catalog`
 * (ensureDefaultFeatures / readFeatureConfig).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    service: { findMany: vi.fn(), createMany: vi.fn() },
    template: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    skill: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../services/catalog', () => ({
  ensureDefaultFeatures: vi.fn().mockResolvedValue(undefined),
  readFeatureConfig: vi.fn(() => ({ kind: 'superpower' })),
}));

import { prisma } from '../../lib/prisma';
import { industryTemplatesRouter } from '../../routes/industryTemplates';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT') {
  return jwt.sign({ userId: 'user_1', businessId: 'biz_1', role }, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/plantillas-negocio', industryTemplatesRouter);
  app.use(errorHandler);
  return app;
}

const VALID_TEMPLATE_ID = 'peluqueria-barberia';

describe('routes/industryTemplates', () => {
  const app = buildApp();
  const adminToken = signToken('ADMIN');
  const clientToken = signToken('CLIENT');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/plantillas-negocio', () => {
    it('lista las plantillas por giro (autenticado)', async () => {
      const res = await request(app)
        .get('/api/plantillas-negocio')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.some((t: { id: string }) => t.id === VALID_TEMPLATE_ID)).toBe(true);
    });

    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/plantillas-negocio');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/plantillas-negocio/:id/aplicar', () => {
    it('devuelve 404 si la plantilla no existe', async () => {
      const res = await request(app)
        .post('/api/plantillas-negocio/giro-inexistente/aplicar')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .post(`/api/plantillas-negocio/${VALID_TEMPLATE_ID}/aplicar`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
    });

    it('aplica la plantilla: crea servicios y activa superpoderes (idempotente)', async () => {
      // No hay servicios previos → crea todos los de la plantilla.
      (prisma.service.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.service.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });
      // No hay prompt previo → lo crea.
      (prisma.template.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.template.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'tpl_1' });
      // Todos los superpoderes de la plantilla existen e inactivos → los activa.
      (prisma.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 's1', name: 'Blindaje anti-invento', isActive: false, config: { kind: 'superpower' } },
        { id: 's2', name: 'Reservas inteligentes', isActive: false, config: { kind: 'superpower' } },
      ]);
      (prisma.skill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await request(app)
        .post(`/api/plantillas-negocio/${VALID_TEMPLATE_ID}/aplicar`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.plantilla.id).toBe(VALID_TEMPLATE_ID);
      expect(prisma.service.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.template.create).toHaveBeenCalledTimes(1);
    });

    it('no re-crea servicios ya existentes (idempotencia por nombre)', async () => {
      // Simula que TODOS los servicios de la plantilla ya existen: no debe crear ninguno.
      // Para eso devolvemos como existentes los nombres que la plantilla trae.
      const { getIndustryTemplate } = await import('../../constants/industryTemplates');
      const template = getIndustryTemplate(VALID_TEMPLATE_ID)!;
      (prisma.service.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        template.servicios.map((s, i) => ({ name: s.name, sortOrder: i + 1 }))
      );
      (prisma.template.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'tpl_1' });
      (prisma.template.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'tpl_1' });
      (prisma.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app)
        .post(`/api/plantillas-negocio/${VALID_TEMPLATE_ID}/aplicar`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.serviciosCreados).toBe(0);
      expect(prisma.service.createMany).not.toHaveBeenCalled();
      // El prompt ya existía → update, no create.
      expect(prisma.template.update).toHaveBeenCalledTimes(1);
      expect(prisma.template.create).not.toHaveBeenCalled();
    });
  });
});
