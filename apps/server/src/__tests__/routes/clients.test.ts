/**
 * Pruebas de integracion para las rutas de clientes
 * (`src/routes/clients.ts`): listado con scope por negocio, lectura,
 * creacion (con validacion y anti-duplicado), y aislamiento multi-tenant.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth setea req.auth).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    const role = (req.header('x-test-role') as 'ADMIN' | 'PROFESSIONAL' | undefined) ?? 'ADMIN';
    req.auth = { userId: 'user_1', businessId: 'biz_1', role };
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

// El CRM (etiquetas/notas) pega a prisma.connection; acá lo mockeamos para
// aislar las rutas de clientes de su persistencia. Los tests del servicio en sí
// viven en __tests__/services/client-crm.test.ts.
vi.mock('../../services/clients/crm', () => ({
  loadClientCrm: vi.fn(async () => ({ tags: [], byClient: {} })),
  saveTags: vi.fn(async (_b: string, tags: unknown) => ({ tags, byClient: {} })),
  setClientTags: vi.fn(async (_b: string, _c: string, tags: string[]) => ({ tags, note: '' })),
  setClientNote: vi.fn(async (_b: string, _c: string, note: string) => ({ tags: [], note })),
  MAX_TAGS: 50,
  MAX_TAG_LABEL_LEN: 40,
  MAX_NOTE_LEN: 2000,
  MAX_TAGS_PER_CLIENT: 20,
  TAG_COLORS: ['slate', 'red', 'blue', 'green'],
}));

// El lifecycle (embudo CRM) también pega a prisma.connection; lo mockeamos para
// aislar las rutas de clientes de su persistencia. Los tests del servicio en sí
// viven en __tests__/services/clients-lifecycle.test.ts.
vi.mock('../../services/clients/lifecycle', () => ({
  loadLifecycle: vi.fn(async () => ({})),
  stageFor: () => 'NEW',
  setClientStage: vi.fn(async (_b: string, _c: string, stage: string) => stage),
  getFunnel: vi.fn(async () => ({
    counts: { NEW: 0, HOT: 0, PAYMENT: 0, CUSTOMER: 0 },
    total: 0,
    stages: ['NEW', 'HOT', 'PAYMENT', 'CUSTOMER'],
  })),
  LIFECYCLE_STAGES: ['NEW', 'HOT', 'PAYMENT', 'CUSTOMER'],
}));

vi.mock('../../services/billing/limits', () => ({ getContactCapacity: vi.fn() }));
vi.mock('../../services/auth/revocation', () => ({ revokeUserSessions: vi.fn(async () => undefined) }));

import { prisma } from '../../lib/prisma';
import { clientsRouter } from '../../routes/clients';
import { loadClientCrm, saveTags, setClientTags, setClientNote } from '../../services/clients/crm';
import { getContactCapacity } from '../../services/billing/limits';
import { revokeUserSessions } from '../../services/auth/revocation';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', clientsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/clients', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto, dentro del cupo de contactos (los tests de límite lo pisan).
    mock(getContactCapacity).mockResolvedValue({ used: 0, limit: 100, atLimit: false });
  });

  describe('GET /api/clients', () => {
    it('devuelve la lista paginada con scope por businessId, role CLIENT y no borrados', async () => {
      mock(prisma.user.findMany).mockResolvedValue([{ id: 'c1', name: 'Ana' }]);
      mock(prisma.user.count).mockResolvedValue(1);

      const res = await request(app).get('/api/clients');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
      expect(res.body.data).toHaveLength(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1', role: 'CLIENT', deletedAt: null },
        })
      );
    });

    it('agrega el filtro OR de busqueda cuando se pasa ?search', async () => {
      mock(prisma.user.findMany).mockResolvedValue([]);
      mock(prisma.user.count).mockResolvedValue(0);

      await request(app).get('/api/clients').query({ search: 'ana' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            OR: expect.arrayContaining([
              expect.objectContaining({ name: { contains: 'ana', mode: 'insensitive' } }),
            ]),
          }),
        })
      );
    });

    it('respeta la paginacion page/pageSize (skip/take)', async () => {
      mock(prisma.user.findMany).mockResolvedValue([]);
      mock(prisma.user.count).mockResolvedValue(0);

      await request(app).get('/api/clients').query({ page: '3', pageSize: '10' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  describe('GET /api/clients/export/csv', () => {
    const clientRow = (over: Partial<{ id: string; name: string; email: string; phone: string }>) => ({
      id: 'c1',
      name: 'Ana',
      email: 'ana@mail.com',
      phone: '123',
      createdAt: new Date('2024-01-02T00:00:00Z'),
      bookingsAsClient: [{ date: new Date('2024-05-01T00:00:00Z') }],
      _count: { bookingsAsClient: 3, orders: 1 },
      ...over,
    });

    it('exporta CSV con BOM, cabecera y scope por businessId/rol/no-borrados', async () => {
      mock(prisma.user.findMany).mockResolvedValue([clientRow({})]);

      const res = await request(app).get('/api/clients/export/csv');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.startsWith('﻿')).toBe(true);
      expect(res.text).toContain('Nombre,Email,Teléfono,Reservas,Órdenes,Última visita,Registrado');
      expect(res.text).toContain('"Ana"');
      expect(res.text).toContain('2024-05-01'); // última visita
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1', role: 'CLIENT', deletedAt: null },
          take: 500,
        })
      );
    });

    it('sanitiza inyección de fórmulas CSV (antepone comilla simple)', async () => {
      mock(prisma.user.findMany).mockResolvedValue([clientRow({ name: '=HYPERLINK("http://x")' })]);

      const res = await request(app).get('/api/clients/export/csv');

      expect(res.status).toBe(200);
      expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    });

    it('en la columna de teléfono deja pasar +54911... y neutraliza el resto de fórmulas', async () => {
      mock(prisma.user.findMany).mockResolvedValue([
        clientRow({ id: 'a', phone: '+5491112345678' }),
        clientRow({ id: 'b', phone: '+cmd|calc' }),
        clientRow({ id: 'c', phone: '=1+1' }),
        clientRow({ id: 'd', name: '+5491112345678' }), // fuera de la columna de teléfono sigue neutralizado
      ]);

      const res = await request(app).get('/api/clients/export/csv');

      expect(res.text).toContain(',"+5491112345678",');
      expect(res.text).toContain(`"'+cmd|calc"`);
      expect(res.text).toContain(`"'=1+1"`);
      expect(res.text).toContain(`"'+5491112345678","ana@mail.com"`);
    });

    it('pagina por cursor cuando hay más registros que el lote', async () => {
      const full = Array.from({ length: 500 }, (_, i) => clientRow({ id: `c${i}` }));
      mock(prisma.user.findMany)
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([clientRow({ id: 'last' })]);

      const res = await request(app).get('/api/clients/export/csv');

      expect(res.status).toBe(200);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
      // La segunda llamada continúa desde el cursor del último id del lote.
      expect(prisma.user.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 1, cursor: { id: 'c499' } })
      );
    });
  });

  describe('GET /api/clients/:id', () => {
    it('devuelve el cliente cuando existe (scope por businessId)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1', name: 'Ana' });

      const res = await request(app).get('/api/clients/c1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'c1' });
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'c1',
            businessId: 'biz_1',
            role: 'CLIENT',
            deletedAt: null,
          }),
        })
      );
    });

    it('devuelve 404 si el cliente no pertenece al negocio (anti cross-tenant)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      const res = await request(app).get('/api/clients/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/clients', () => {
    const validPayload = { name: 'Ana Perez', email: 'ana@example.com' };

    it('crea un cliente con datos validos (201) inyectando el businessId del auth', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null); // no existe email previo
      mock(prisma.user.create).mockResolvedValue({ id: 'c1', ...validPayload });

      const res = await request(app).post('/api/clients').send(validPayload);

      expect(res.status).toBe(201);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Ana Perez',
            email: 'ana@example.com',
            role: 'CLIENT',
            businessId: 'biz_1',
          }),
        })
      );
    });

    it('devuelve 409 si ya existe un cliente con ese email', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'existente' });

      const res = await request(app).post('/api/clients').send(validPayload);

      expect(res.status).toBe(409);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('devuelve 400 cuando falta el email (validacion Zod)', async () => {
      const res = await request(app).post('/api/clients').send({ name: 'Ana Perez' });

      expect(res.status).toBe(400);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('devuelve 403 cuando se alcanzó el límite de contactos del plan (sin crear)', async () => {
      mock(getContactCapacity).mockResolvedValue({ used: 100, limit: 100, atLimit: true });

      const res = await request(app).post('/api/clients').send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', limit: 100 });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/clients/:id', () => {
    it('actualiza un cliente existente (scope por businessId)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1', name: 'Ana Nueva' });

      const res = await request(app).patch('/api/clients/c1').send({ name: 'Ana Nueva' });

      expect(res.status).toBe(200);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'c1', businessId: 'biz_1', role: 'CLIENT' }),
        })
      );
    });

    it('devuelve 404 si el cliente no existe en el negocio', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      const res = await request(app).patch('/api/clients/no-existe').send({ name: 'Nuevo' });

      expect(res.status).toBe(404);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/clients/:id', () => {
    it('hace soft-delete (setea deletedAt) cuando el cliente existe', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1', deletedAt: new Date() });

      const res = await request(app).delete('/api/clients/c1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        })
      );
    });

    it('devuelve 404 si el cliente no existe en el negocio', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);

      const res = await request(app).delete('/api/clients/no-existe');

      expect(res.status).toBe(404);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('revoca las sesiones del cliente dado de baja (su JWT no sigue valiendo 14 días)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1' });

      await request(app).delete('/api/clients/c1');

      expect(revokeUserSessions).toHaveBeenCalledWith('biz_1', 'c1');
    });

    it('si falla la revocación igual responde éxito pero avisa revocationFailed', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1' });
      mock(revokeUserSessions).mockRejectedValueOnce(new Error('db caída'));

      const res = await request(app).delete('/api/clients/c1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, revocationFailed: true });
    });

    it('libera el email en la baja (anonimiza) y desactiva la cuenta', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1' });

      await request(app).delete('/api/clients/c1');

      expect(mock(prisma.user.update).mock.calls[0][0].data).toMatchObject({
        email: 'deleted+c1@invalid.local',
        isActive: false,
        deletedAt: expect.any(Date),
      });
    });

    it('un PROFESSIONAL no puede dar de baja clientes (403) y no se toca nada', async () => {
      const res = await request(app).delete('/api/clients/c1').set('x-test-role', 'PROFESSIONAL');

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(revokeUserSessions).not.toHaveBeenCalled();
    });

    it('el export CSV sigue abierto al staff (PROFESSIONAL)', async () => {
      mock(prisma.user.findMany).mockResolvedValue([]);
      const res = await request(app).get('/api/clients/export/csv').set('x-test-role', 'PROFESSIONAL');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/clients — email y topes', () => {
    beforeEach(() => {
      mock(prisma.user.findFirst).mockResolvedValue(null);
      mock(prisma.user.create).mockResolvedValue({ id: 'c1' });
    });

    it('normaliza el email a minúsculas (el login también compara en minúsculas)', async () => {
      await request(app).post('/api/clients').send({ name: 'Ana Perez', email: '  Ana@Example.COM ' });
      expect(mock(prisma.user.create).mock.calls[0][0].data.email).toBe('ana@example.com');
    });

    it('si el email ya lo usa un usuario de OTRO negocio (P2002) responde un 409 genérico sin nombrar el campo', async () => {
      mock(prisma.user.create).mockRejectedValue(Object.assign(new Error('Unique'), { code: 'P2002', meta: { target: ['email'] } }));

      const res = await request(app).post('/api/clients').send({ name: 'Ana Perez', email: 'otra@tenant.com' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/email.*existe|otro negocio|tenant/i);
      expect(res.body.error).not.toContain('Ya existe un registro');
    });

    it('rechaza (400) nombre, email o teléfono por encima del tope', async () => {
      const long = (n: number) => 'a'.repeat(n);
      const r1 = await request(app).post('/api/clients').send({ name: long(101), email: 'a@b.com' });
      const r2 = await request(app).post('/api/clients').send({ name: 'Ana', email: `${long(250)}@b.com` });
      const r3 = await request(app).post('/api/clients').send({ name: 'Ana', email: 'a@b.com', phone: long(31) });
      expect([r1.status, r2.status, r3.status]).toEqual([400, 400, 400]);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/clients/:id — validación', () => {
    beforeEach(() => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.user.update).mockResolvedValue({ id: 'c1' });
    });

    it('el avatar solo acepta https', async () => {
      const bad = await request(app).patch('/api/clients/c1').send({ avatar: 'http://x.com/a.png' });
      const js = await request(app).patch('/api/clients/c1').send({ avatar: 'javascript:alert(1)' });
      const ok = await request(app).patch('/api/clients/c1').send({ avatar: 'https://x.com/a.png' });
      expect([bad.status, js.status, ok.status]).toEqual([400, 400, 200]);
    });

    it('un teléfono vacío o null lo borra (se guarda null)', async () => {
      await request(app).patch('/api/clients/c1').send({ phone: '' });
      expect(mock(prisma.user.update).mock.calls[0][0].data.phone).toBeNull();
      await request(app).patch('/api/clients/c1').send({ phone: null });
      expect(mock(prisma.user.update).mock.calls[1][0].data.phone).toBeNull();
    });

    it('rechaza nombre > 100 y teléfono > 30 caracteres', async () => {
      const r1 = await request(app).patch('/api/clients/c1').send({ name: 'a'.repeat(101) });
      const r2 = await request(app).patch('/api/clients/c1').send({ phone: '1'.repeat(31) });
      expect([r1.status, r2.status]).toEqual([400, 400]);
    });
  });

  describe('CRM: etiquetas y notas', () => {
    it('adjunta las etiquetas de cada cliente y el catálogo en el listado', async () => {
      mock(loadClientCrm).mockResolvedValueOnce({
        tags: [{ id: 't1', label: 'VIP', color: 'blue' }],
        byClient: { c1: { tags: ['t1'], note: 'cliente fiel' } },
      });
      mock(prisma.user.findMany).mockResolvedValue([{ id: 'c1', name: 'Ana' }]);
      mock(prisma.user.count).mockResolvedValue(1);

      const res = await request(app).get('/api/clients');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({ id: 'c1', tags: ['t1'] });
      expect(res.body.tagCatalog).toEqual([{ id: 't1', label: 'VIP', color: 'blue' }]);
    });

    it('filtra por ?tagId restringiendo los ids ANTES de la query (paginación correcta)', async () => {
      mock(loadClientCrm).mockResolvedValueOnce({
        tags: [{ id: 't1', label: 'VIP', color: 'blue' }],
        byClient: { c1: { tags: ['t1'], note: '' }, c2: { tags: [], note: 'x' } },
      });
      mock(prisma.user.findMany).mockResolvedValue([{ id: 'c1', name: 'Ana' }]);
      mock(prisma.user.count).mockResolvedValue(1);

      await request(app).get('/api/clients').query({ tagId: 't1' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['c1'] } }),
        })
      );
    });

    it('GET /crm devuelve el catálogo + anotaciones del negocio', async () => {
      mock(loadClientCrm).mockResolvedValueOnce({
        tags: [{ id: 't1', label: 'VIP', color: 'blue' }],
        byClient: {},
      });
      const res = await request(app).get('/api/clients/crm');
      expect(res.status).toBe(200);
      expect(res.body.tags).toHaveLength(1);
      expect(loadClientCrm).toHaveBeenCalledWith('biz_1');
    });

    it('PUT /crm/tags reemplaza el catálogo (200)', async () => {
      const res = await request(app)
        .put('/api/clients/crm/tags')
        .send({ tags: [{ label: 'Nuevo', color: 'green' }] });
      expect(res.status).toBe(200);
      expect(saveTags).toHaveBeenCalledWith('biz_1', [{ label: 'Nuevo', color: 'green' }]);
    });

    it('PUT /crm/tags devuelve 400 con un color fuera del enum', async () => {
      const res = await request(app)
        .put('/api/clients/crm/tags')
        .send({ tags: [{ label: 'X', color: 'fucsia' }] });
      expect(res.status).toBe(400);
      expect(saveTags).not.toHaveBeenCalled();
    });

    it('PUT /:id/tags setea etiquetas cuando el cliente es del negocio', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      const res = await request(app).put('/api/clients/c1/tags').send({ tags: ['t1'] });
      expect(res.status).toBe(200);
      expect(setClientTags).toHaveBeenCalledWith('biz_1', 'c1', ['t1']);
    });

    it('PUT /:id/tags devuelve 404 si el cliente no es del negocio (anti cross-tenant)', async () => {
      mock(prisma.user.findFirst).mockResolvedValue(null);
      const res = await request(app).put('/api/clients/ajeno/tags').send({ tags: ['t1'] });
      expect(res.status).toBe(404);
      expect(setClientTags).not.toHaveBeenCalled();
    });

    it('PUT /:id/note setea la nota interna del cliente', async () => {
      mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
      const res = await request(app).put('/api/clients/c1/note').send({ note: 'llamar el lunes' });
      expect(res.status).toBe(200);
      expect(setClientNote).toHaveBeenCalledWith('biz_1', 'c1', 'llamar el lunes');
    });
  });
});
