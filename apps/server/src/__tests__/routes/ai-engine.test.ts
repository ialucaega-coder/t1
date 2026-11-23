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
  UnknownEngineError: class UnknownEngineError extends Error {},
}));

import { listEnginesForBusiness, setActiveEngine, setEngineKey, UnknownEngineError } from '../../services/ai/engine';
import { aiRouter } from '../../routes/ai';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const token = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const proToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'PROFESSIONAL' }, JWT_SECRET);

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
      mock(setActiveEngine).mockRejectedValue(new UnknownEngineError('x'));
      const res = await request(app).put('/api/ai/engine')
        .set('Authorization', `Bearer ${token}`)
        .send({ engineId: 'x' });
      expect(res.status).toBe(400);
    });

    it('500 (no 400) si falla algo que no es un motor inexistente', async () => {
      mock(setActiveEngine).mockRejectedValue(new Error('db caída'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await request(app).put('/api/ai/engine')
        .set('Authorization', `Bearer ${token}`)
        .send({ engineId: 'gpt-4o' });
      expect(res.status).toBe(500);
      err.mockRestore();
    });

    it('un PROFESSIONAL NO puede cambiar el motor (403) y no se toca la config', async () => {
      const res = await request(app).put('/api/ai/engine')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ engineId: 'gpt-4o' });
      expect(res.status).toBe(403);
      expect(mock(setActiveEngine)).not.toHaveBeenCalled();
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

    it('un PROFESSIONAL NO puede reemplazar ni borrar la key del negocio (403)', async () => {
      const set = await request(app).put('/api/ai/keys')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ provider: 'openai', apiKey: 'sk-atacante' });
      const del = await request(app).put('/api/ai/keys')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ provider: 'openai', apiKey: '' });
      expect(set.status).toBe(403);
      expect(del.status).toBe(403);
      expect(mock(setEngineKey)).not.toHaveBeenCalled();
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
