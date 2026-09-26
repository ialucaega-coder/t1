/**
 * Tests de las rutas del Motor de IA en routes/ai.ts:
 * GET /engines, PUT /engine, PUT /keys. Se mockea la capa de servicio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: { business: { findUnique: vi.fn() }, service: { findMany: vi.fn() } },
}));
vi.mock('../../services/chatbot', () => ({ processMessage: vi.fn() }));
vi.mock('../../services/ai', () => ({
  listAvailableProviders: vi.fn(() => []),
  getDefaultAIProvider: vi.fn(() => ({ name: 'anthropic' })),
}));
vi.mock('../../services/ai/engine', () => ({
  listEnginesForBusiness: vi.fn(),
  setActiveEngine: vi.fn(),
  setEngineKey: vi.fn(),
}));

import { listEnginesForBusiness, setActiveEngine, setEngineKey } from '../../services/ai/engine';
import { aiRouter } from '../../routes/ai';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const token = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/ai — Motor de IA', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/ai/engines', () => {
    it('401 sin token', async () => {
      const res = await request(app).get('/api/ai/engines');
      expect(res.status).toBe(401);
    });

    it('devuelve el catálogo con estado', async () => {
      mock(listEnginesForBusiness).mockResolvedValue({
        activeEngineId: 'gpt-4o',
        engines: [{ id: 'gpt-4o', name: 'GPT-4o', active: true, ready: true }],
      });
      const res = await request(app).get('/api/ai/engines').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.activeEngineId).toBe('gpt-4o');
      expect(mock(listEnginesForBusiness)).toHaveBeenCalledWith('biz_1');
    });
  });

  describe('PUT /api/ai/engine', () => {
    it('cambia el motor activo', async () => {
      mock(setActiveEngine).mockResolvedValue({ activeEngineId: 'gemini-2.0-flash' });
      const res = await request(app).put('/api/ai/engine')
        .set('Authorization', `Bearer ${token}`)
        .send({ engineId: 'gemini-2.0-flash' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, activeEngineId: 'gemini-2.0-flash' });
    });

    it('400 si el motor es desconocido', async () => {
      mock(setActiveEngine).mockRejectedValue(new Error('Motor de IA desconocido: x'));
      const res = await request(app).put('/api/ai/engine')
        .set('Authorization', `Bearer ${token}`)
        .send({ engineId: 'x' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/ai/keys', () => {
    it('guarda la key de un proveedor válido', async () => {
      mock(setEngineKey).mockResolvedValue({ activeEngineId: 'gpt-4o', keys: { openai: 'x' } });
      const res = await request(app).put('/api/ai/keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ provider: 'openai', apiKey: 'sk-123' });
      expect(res.status).toBe(200);
      expect(mock(setEngineKey)).toHaveBeenCalledWith('biz_1', 'openai', 'sk-123');
    });

    it('400 si el proveedor es desconocido', async () => {
      const res = await request(app).put('/api/ai/keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ provider: 'hacker', apiKey: 'x' });
      expect(res.status).toBe(400);
      expect(mock(setEngineKey)).not.toHaveBeenCalled();
    });
  });
});
