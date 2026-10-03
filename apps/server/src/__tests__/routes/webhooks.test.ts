/**
 * Pruebas de integración del router de webhooks (routes/webhooks.ts): listado y
 * catálogo de eventos, alta/edición/baja scoped por negocio, el guard anti-SSRF
 * (al guardar y al probar) y el endpoint /test que hace fetch al destino.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
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
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../lib/ssrf', () => ({
  assertSafePublicUrl: vi.fn(async (u: string) => new URL(u)),
}));

import { prisma } from '../../lib/prisma';
import { assertSafePublicUrl } from '../../lib/ssrf';
import { AppError } from '../../middleware/errorHandler';
import { webhooksRouter } from '../../routes/webhooks';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhooksRouter);
  app.use(errorHandler);
  return app;
}

const validPayload = { name: 'Mi hook', url: 'https://hooks.example.com/e', events: ['booking.created'] };

describe('routes/webhooks', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(assertSafePublicUrl).mockImplementation(async (u: string) => new URL(u));
    // fetch global para POST /:id/test
    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi.fn(async () => ({ ok: true, status: 200 }));
  });

  describe('GET /', () => {
    it('lista los webhooks del negocio (scoped por businessId) y aplana config', async () => {
      mock(prisma.connection.findMany).mockResolvedValue([
        { id: 'w1', name: 'Hook', isActive: true, config: { url: 'https://x.com', events: ['booking.created'] } },
      ]);
      const res = await request(app).get('/api/webhooks');
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({ id: 'w1', name: 'Hook', url: 'https://x.com' });
      expect(prisma.connection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', type: 'webhook' } })
      );
    });

    it('NO expone el secret en el listado (solo hasSecret)', async () => {
      mock(prisma.connection.findMany).mockResolvedValue([
        { id: 'w1', name: 'Hook', isActive: true, config: { url: 'https://x.com', events: [], secret: 'enc:tag:ct' } },
      ]);
      const res = await request(app).get('/api/webhooks');
      expect(res.status).toBe(200);
      expect(res.body[0].secret).toBeUndefined();
      expect(res.body[0].hasSecret).toBe(true);
    });
  });

  describe('GET /events', () => {
    it('devuelve el catálogo de eventos disponibles', async () => {
      const res = await request(app).get('/api/webhooks/events');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('booking.created');
    });
  });

  describe('POST /', () => {
    it('crea un webhook válido (valida la URL anti-SSRF)', async () => {
      mock(prisma.connection.create).mockResolvedValue({ id: 'w1', name: 'Mi hook', isActive: true, config: { url: validPayload.url, events: validPayload.events } });
      const res = await request(app).post('/api/webhooks').send(validPayload);
      expect(res.status).toBe(201);
      expect(assertSafePublicUrl).toHaveBeenCalledWith(validPayload.url);
      expect(prisma.connection.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'webhook', businessId: 'biz_1' }) })
      );
    });

    it('cifra el secret al crear y no lo devuelve (hasSecret)', async () => {
      mock(prisma.connection.create).mockImplementation(async (args: { data: { config: Record<string, unknown> } }) => ({
        id: 'w1', name: 'Mi hook', isActive: true, config: args.data.config,
      }));
      const res = await request(app).post('/api/webhooks').send({ ...validPayload, secret: 'mi-secreto' });
      expect(res.status).toBe(201);
      const storedCfg = mock(prisma.connection.create).mock.calls[0][0].data.config;
      expect(storedCfg.secret).not.toBe('mi-secreto'); // cifrado en reposo
      expect(String(storedCfg.secret).split(':').length).toBe(3);
      expect(res.body.secret).toBeUndefined();
      expect(res.body.hasSecret).toBe(true);
    });

    it('rechaza (400) si falta la URL', async () => {
      const res = await request(app).post('/api/webhooks').send({ name: 'x', events: ['booking.created'] });
      expect(res.status).toBe(400);
      expect(prisma.connection.create).not.toHaveBeenCalled();
    });

    it('rechaza (400) una URL interna (anti-SSRF)', async () => {
      mock(assertSafePublicUrl).mockRejectedValue(new AppError(400, 'Host no permitido'));
      const res = await request(app).post('/api/webhooks').send({ ...validPayload, url: 'http://169.254.169.254/' });
      expect(res.status).toBe(400);
      expect(prisma.connection.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /:id', () => {
    it('404 si el webhook no existe en el negocio', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      const res = await request(app).patch('/api/webhooks/w1').send({ name: 'nuevo' });
      expect(res.status).toBe(404);
    });

    it('actualiza y valida la URL nueva anti-SSRF', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'w1', config: { url: 'https://old.com' } });
      mock(prisma.connection.update).mockResolvedValue({ id: 'w1', name: 'Mi hook', isActive: true, config: { url: 'https://new.com' } });
      const res = await request(app).patch('/api/webhooks/w1').send({ url: 'https://new.com' });
      expect(res.status).toBe(200);
      expect(assertSafePublicUrl).toHaveBeenCalledWith('https://new.com');
    });
  });

  describe('DELETE /:id', () => {
    it('404 si no existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      const res = await request(app).delete('/api/webhooks/w1');
      expect(res.status).toBe(404);
    });

    it('borra y responde 204', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'w1' });
      mock(prisma.connection.delete).mockResolvedValue({});
      const res = await request(app).delete('/api/webhooks/w1');
      expect(res.status).toBe(204);
    });
  });

  describe('POST /:id/test', () => {
    it('hace fetch al destino y devuelve success/status', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'w1', config: { url: 'https://hooks.example.com/e' } });
      const res = await request(app).post('/api/webhooks/w1/test');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, status: 200 });
      expect(assertSafePublicUrl).toHaveBeenCalledWith('https://hooks.example.com/e');
    });

    it('rechaza (400) si el destino es interno (anti-SSRF)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'w1', config: { url: 'http://127.0.0.1' } });
      mock(assertSafePublicUrl).mockRejectedValue(new AppError(400, 'Host no permitido'));
      const res = await request(app).post('/api/webhooks/w1/test');
      expect(res.status).toBe(400);
      expect((globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch).not.toHaveBeenCalled();
    });
  });
});
