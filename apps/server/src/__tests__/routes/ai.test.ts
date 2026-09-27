/**
 * Pruebas del router de IA (routes/ai.ts): chat del bot, generación de prompt a
 * partir de datos reales del negocio, listado de proveedores y el "Motor de IA"
 * (engines / engine activo / API keys con whitelist de familias).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
  },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../services/chatbot', () => ({ processMessage: vi.fn() }));
vi.mock('../../services/ai', () => ({
  listAvailableProviders: vi.fn(() => [{ name: 'anthropic', configured: true }]),
  getDefaultAIProvider: vi.fn(() => ({ name: 'anthropic' })),
}));
vi.mock('../../services/ai/engine', () => ({
  listEnginesForBusiness: vi.fn(),
  setActiveEngine: vi.fn(),
  setEngineKey: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { processMessage } from '../../services/chatbot';
import { getDefaultAIProvider } from '../../services/ai';
import { listEnginesForBusiness, setActiveEngine, setEngineKey } from '../../services/ai/engine';
import { aiRouter } from '../../routes/ai';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/ai', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(getDefaultAIProvider).mockReturnValue({ name: 'anthropic' });
  });

  describe('POST /chat', () => {
    it('procesa el mensaje con el businessId del token', async () => {
      mock(processMessage).mockResolvedValue({ text: 'hola', conversationId: 'c1', intent: 'FAQ', actions: [] });
      const res = await request(app).post('/api/ai/chat').send({ message: 'hola', channel: 'WEB' });
      expect(res.status).toBe(200);
      expect(res.body.text).toBe('hola');
      expect(mock(processMessage)).toHaveBeenCalledWith('biz_1', 'hola', 'WEB', expect.any(Object));
    });

    it('rechaza (400) un mensaje vacío', async () => {
      const res = await request(app).post('/api/ai/chat').send({ message: '' });
      expect(res.status).toBe(400);
      expect(mock(processMessage)).not.toHaveBeenCalled();
    });
  });

  describe('POST /generate-prompt', () => {
    it('genera un prompt con el nombre del negocio y su catálogo', async () => {
      mock(prisma.business.findUnique).mockResolvedValue({ id: 'biz_1', name: 'Barbería Central' });
      mock(prisma.service.findMany).mockResolvedValue([{ name: 'Corte', price: 1000, duration: 30, currency: 'ARS' }]);
      const res = await request(app).post('/api/ai/generate-prompt').send({ tone: 'formal' });
      expect(res.status).toBe(200);
      expect(res.body.prompt).toContain('Barbería Central');
      expect(res.body.prompt).toContain('Corte');
    });

    it('404 si el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);
      mock(prisma.service.findMany).mockResolvedValue([]);
      const res = await request(app).post('/api/ai/generate-prompt').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('GET /providers', () => {
    it('lista proveedores y el default', async () => {
      const res = await request(app).get('/api/ai/providers');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ defaultProvider: 'anthropic' });
      expect(Array.isArray(res.body.providers)).toBe(true);
    });

    it('defaultProvider null si ninguno está configurado', async () => {
      mock(getDefaultAIProvider).mockImplementation(() => { throw new Error('no provider'); });
      const res = await request(app).get('/api/ai/providers');
      expect(res.status).toBe(200);
      expect(res.body.defaultProvider).toBeNull();
    });
  });

  describe('Motor de IA', () => {
    it('GET /engines devuelve el catálogo scoped al negocio', async () => {
      mock(listEnginesForBusiness).mockResolvedValue({ activeEngineId: 'claude-sonnet', engines: [] });
      const res = await request(app).get('/api/ai/engines');
      expect(res.status).toBe(200);
      expect(mock(listEnginesForBusiness)).toHaveBeenCalledWith('biz_1');
    });

    it('PUT /engine cambia el motor activo', async () => {
      mock(setActiveEngine).mockResolvedValue({ activeEngineId: 'gpt-4o' });
      const res = await request(app).put('/api/ai/engine').send({ engineId: 'gpt-4o' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, activeEngineId: 'gpt-4o' });
    });

    it('PUT /engine responde 400 si el motor es desconocido', async () => {
      mock(setActiveEngine).mockRejectedValue(new Error('Motor de IA desconocido'));
      const res = await request(app).put('/api/ai/engine').send({ engineId: 'no-existe' });
      expect(res.status).toBe(400);
    });

    it('PUT /keys guarda la key de una familia válida', async () => {
      mock(setEngineKey).mockResolvedValue({});
      const res = await request(app).put('/api/ai/keys').send({ provider: 'openai', apiKey: 'sk-xxx' });
      expect(res.status).toBe(200);
      expect(mock(setEngineKey)).toHaveBeenCalledWith('biz_1', 'openai', 'sk-xxx');
    });

    it('PUT /keys rechaza (400) una familia fuera de la whitelist', async () => {
      const res = await request(app).put('/api/ai/keys').send({ provider: 'hacker', apiKey: 'x' });
      expect(res.status).toBe(400);
      expect(mock(setEngineKey)).not.toHaveBeenCalled();
    });
  });
});
