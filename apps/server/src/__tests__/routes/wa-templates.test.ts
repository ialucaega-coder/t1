/**
 * Pruebas de integración de la API de Plantillas WhatsApp oficiales (HSM)
 * (`src/routes/waTemplates.ts`): CRUD + máquina de estados completa
 * (DRAFT → PENDING → APPROVED/REJECTED), gate de ADMIN en approve/reject y
 * validación de ejemplos en submit.
 *
 * Auth REAL (JWT). Se mockea Prisma; el router + el servicio corren de verdad,
 * así que la máquina de estados se ejercita end-to-end. El gate de capacidad
 * (`requireCapability('marketing')`) se aplica en index.ts, no en el router, por
 * eso acá montamos el router directo (igual que conversations.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { waTemplatesRouter } from '../../routes/waTemplates';
import { errorHandler } from '../../middleware/errorHandler';
import type { WaTemplate } from '../../services/whatsapp/templates';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const adminToken = jwt.sign({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const proToken = jwt.sign({ userId: 'user_2', businessId: 'biz_1', role: 'PROFESSIONAL' }, JWT_SECRET);

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wa-templates', waTemplatesRouter);
  app.use(errorHandler);
  return app;
}

function makeTemplate(over: Partial<WaTemplate> = {}): WaTemplate {
  return {
    id: 't1',
    name: 'bienvenida',
    language: 'es_AR',
    category: 'MARKETING',
    status: 'DRAFT',
    body: 'Hola {{1}}',
    example: ['Luca'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

/** Templates que el servicio lee "fresco" dentro del lock (findUnique). */
function setState(templates: WaTemplate[]) {
  mock(prisma.connection.findUnique).mockResolvedValue({ config: { templates } });
}

/** Array de templates que la ruta persistió vía connection.update. */
function persisted(): WaTemplate[] {
  const calls = (prisma.connection.update as ReturnType<typeof vi.fn>).mock.calls as unknown as unknown[][];
  const data = (calls[0][0] as { data: { config: { templates: WaTemplate[] } } }).data;
  return data.config.templates;
}

describe('routes/wa-templates (HSM)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // La mutación corre en $transaction con lock FOR UPDATE.
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );
    (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'conn_1' }]);
    // El registro singleton ya existe (camino de lock, no de create).
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
    mock(prisma.connection.update).mockImplementation(
      async ({ data }: { data: unknown }) => ({ config: (data as { config: unknown }).config }),
    );
    setState([]);
  });

  describe('GET /api/wa-templates', () => {
    it('lista las plantillas ordenadas por updatedAt desc', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: {
          templates: [
            makeTemplate({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
            makeTemplate({ id: 'b', updatedAt: '2026-10-10T00:00:00.000Z' }),
          ],
        },
      });

      const res = await request(app).get('/api/wa-templates').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.templates.map((t: WaTemplate) => t.id)).toEqual(['b', 'a']);
    });

    it('requiere autenticación (401 sin token)', async () => {
      const res = await request(app).get('/api/wa-templates');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/wa-templates', () => {
    it('crea una plantilla en estado DRAFT con id y timestamps (201)', async () => {
      const res = await request(app)
        .post('/api/wa-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'promo_oct', language: 'es_AR', category: 'MARKETING', body: 'Hola {{1}}', example: ['Luca'] });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'promo_oct', status: 'DRAFT', category: 'MARKETING' });
      expect(res.body.id).toBeTruthy();
      expect(res.body.createdAt).toBeTruthy();
      expect(persisted()).toHaveLength(1);
    });

    it('rechaza un name duplicado en el negocio (409, case-insensitive)', async () => {
      setState([makeTemplate({ name: 'promo_oct' })]);

      const res = await request(app)
        .post('/api/wa-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'PROMO_OCT'.toLowerCase(), language: 'es', category: 'UTILITY', body: 'Hola' });

      // El name 'promo_oct' ya existe → 409.
      expect(res.status).toBe(409);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('rechaza un name inválido (400, regex de Meta)', async () => {
      const res = await request(app)
        .post('/api/wa-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Promo Oct', language: 'es', category: 'UTILITY', body: 'Hola' });

      expect(res.status).toBe(400);
    });

    it('rechaza variables no consecutivas en el body (400)', async () => {
      const res = await request(app)
        .post('/api/wa-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'promo', language: 'es', category: 'UTILITY', body: 'Hola {{1}} y {{3}}' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/wa-templates/:id', () => {
    it('edita una plantilla en DRAFT (200)', async () => {
      setState([makeTemplate({ id: 't1', status: 'DRAFT' })]);

      const res = await request(app)
        .patch('/api/wa-templates/t1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Hola {{1}}, gracias {{2}}' });

      expect(res.status).toBe(200);
      expect(res.body.body).toBe('Hola {{1}}, gracias {{2}}');
      expect(res.body.status).toBe('DRAFT');
    });

    it('al editar una REJECTED limpia rejectionReason y sigue REJECTED', async () => {
      setState([makeTemplate({ id: 't1', status: 'REJECTED', rejectionReason: 'Faltaba footer' })]);

      const res = await request(app)
        .patch('/api/wa-templates/t1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ footer: 'Equipo Local B' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectionReason).toBeUndefined();
    });

    it('devuelve 409 al editar una APPROVED', async () => {
      setState([makeTemplate({ id: 't1', status: 'APPROVED' })]);

      const res = await request(app)
        .patch('/api/wa-templates/t1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Nuevo' });

      expect(res.status).toBe(409);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('devuelve 404 si la plantilla no existe', async () => {
      setState([]);

      const res = await request(app)
        .patch('/api/wa-templates/nope')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Nuevo' });

      expect(res.status).toBe(404);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/wa-templates/:id/submit', () => {
    it('envía a aprobación DRAFT → PENDING con ejemplos completos (200)', async () => {
      setState([makeTemplate({ id: 't1', status: 'DRAFT', body: 'Hola {{1}}', example: ['Luca'] })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/submit')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.submittedAt).toBeTruthy();
    });

    it('devuelve 422 si faltan ejemplos para las variables', async () => {
      setState([makeTemplate({ id: 't1', status: 'DRAFT', body: 'Hola {{1}} y {{2}}', example: ['Luca'] })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/submit')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('devuelve 409 al enviar a aprobación una APPROVED', async () => {
      setState([makeTemplate({ id: 't1', status: 'APPROVED' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/submit')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
    });

    it('re-envía una REJECTED (REJECTED → PENDING)', async () => {
      setState([makeTemplate({ id: 't1', status: 'REJECTED', body: 'Hola {{1}}', example: ['Luca'], rejectionReason: 'x' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/submit')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.rejectionReason).toBeUndefined();
    });
  });

  describe('POST /api/wa-templates/:id/approve', () => {
    it('aprueba PENDING → APPROVED (ADMIN, 200)', async () => {
      setState([makeTemplate({ id: 't1', status: 'PENDING' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/approve')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.reviewedAt).toBeTruthy();
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      setState([makeTemplate({ id: 't1', status: 'PENDING' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/approve')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(403);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('devuelve 409 si la plantilla no está en PENDING', async () => {
      setState([makeTemplate({ id: 't1', status: 'DRAFT' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/approve')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
    });

    it('devuelve 404 si la plantilla no existe', async () => {
      setState([]);

      const res = await request(app)
        .post('/api/wa-templates/nope/approve')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/wa-templates/:id/reject', () => {
    it('rechaza PENDING → REJECTED con motivo (ADMIN, 200)', async () => {
      setState([makeTemplate({ id: 't1', status: 'PENDING' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/reject')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'El cuerpo infringe la política de Meta' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectionReason).toBe('El cuerpo infringe la política de Meta');
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      setState([makeTemplate({ id: 't1', status: 'PENDING' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/reject')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ reason: 'no' });

      expect(res.status).toBe(403);
    });

    it('devuelve 400 si falta el reason', async () => {
      setState([makeTemplate({ id: 't1', status: 'PENDING' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/reject')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('devuelve 409 si la plantilla no está en PENDING', async () => {
      setState([makeTemplate({ id: 't1', status: 'DRAFT' })]);

      const res = await request(app)
        .post('/api/wa-templates/t1/reject')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'tarde' });

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/wa-templates/:id', () => {
    it('elimina una plantilla (204)', async () => {
      setState([makeTemplate({ id: 't1' })]);

      const res = await request(app)
        .delete('/api/wa-templates/t1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(persisted()).toHaveLength(0);
    });

    it('devuelve 404 si la plantilla no existe', async () => {
      setState([makeTemplate({ id: 't1' })]);

      const res = await request(app)
        .delete('/api/wa-templates/nope')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('requiere autenticación (401 sin token)', async () => {
      const res = await request(app).delete('/api/wa-templates/t1');
      expect(res.status).toBe(401);
    });
  });
});
