/**
 * Pruebas de integración para las rutas de Voz de Marca (`src/routes/brand.ts`):
 * GET devuelve la voz de marca del negocio y PUT la actualiza (merge parcial,
 * solo ADMIN).
 *
 * Middleware de auth REAL (JWT) para testear 401/403; se mockea la capa de
 * servicio (`services/brand/config`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/brand/config', () => ({
  loadBrandVoice: vi.fn(),
  saveBrandVoice: vi.fn(),
}));

import { loadBrandVoice, saveBrandVoice } from '../../services/brand/config';
import { brandRouter } from '../../routes/brand';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT') {
  return jwt.sign({ userId: 'user_1', businessId: 'biz_1', role }, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brand', brandRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/brand', () => {
  const app = buildApp();
  const adminToken = signToken('ADMIN');
  const proToken = signToken('PROFESSIONAL');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/brand', () => {
    it('devuelve la voz de marca del negocio', async () => {
      const voice = { tono: 'cercano', publicoObjetivo: 'jóvenes', infoNegocio: '', reglas: '', emojis: true };
      (loadBrandVoice as ReturnType<typeof vi.fn>).mockResolvedValue(voice);

      const res = await request(app).get('/api/brand').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(voice);
      expect(loadBrandVoice).toHaveBeenCalledWith('biz_1');
    });

    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/brand');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/brand', () => {
    it('actualiza la voz de marca con un patch válido (ADMIN)', async () => {
      const patch = { tono: 'formal', emojis: false };
      const saved = { tono: 'formal', publicoObjetivo: '', infoNegocio: '', reglas: '', emojis: false };
      (saveBrandVoice as ReturnType<typeof vi.fn>).mockResolvedValue(saved);

      const res = await request(app)
        .put('/api/brand')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(patch);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(saved);
      expect(saveBrandVoice).toHaveBeenCalledWith('biz_1', expect.objectContaining(patch));
    });

    it('devuelve 400 si un campo tiene el tipo equivocado', async () => {
      const res = await request(app)
        .put('/api/brand')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ emojis: 'sí' });

      expect(res.status).toBe(400);
      expect(saveBrandVoice).not.toHaveBeenCalled();
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .put('/api/brand')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ tono: 'formal' });

      expect(res.status).toBe(403);
      expect(saveBrandVoice).not.toHaveBeenCalled();
    });
  });
});
