/**
 * Pruebas de integración para las rutas de la galería (`src/routes/galeria.ts`),
 * superpoder "Galería": listar (GET), agregar (POST, solo ADMIN) y eliminar
 * (DELETE, solo ADMIN) items de medios.
 *
 * Se usa el middleware de auth REAL (JWT firmado) para poder testear 401/403,
 * y se mockea la capa de servicio (`services/gallery/config`) para aislar la
 * ruta de la base de datos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/gallery/config', () => ({
  loadGallery: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
}));

import { loadGallery, addItem, removeItem } from '../../services/gallery/config';
import { galeriaRouter } from '../../routes/galeria';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

function signToken(role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT', businessId = 'biz_1') {
  return jwt.sign({ userId: 'user_1', businessId, role }, JWT_SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/galeria', galeriaRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/galeria', () => {
  const app = buildApp();
  const adminToken = signToken('ADMIN');
  const clientToken = signToken('CLIENT');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/galeria', () => {
    it('devuelve los items de la galería del negocio autenticado', async () => {
      const items = [
        { id: 'g1', url: 'https://cdn.test/a.jpg', tipo: 'image', titulo: 'A', descripcion: '', createdAt: '2026-01-01T00:00:00.000Z' },
      ];
      (loadGallery as ReturnType<typeof vi.fn>).mockResolvedValue(items);

      const res = await request(app).get('/api/galeria').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(items);
      expect(loadGallery).toHaveBeenCalledWith('biz_1');
    });

    it('cualquier rol autenticado puede listar (no requiere ADMIN)', async () => {
      (loadGallery as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).get('/api/galeria').set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
    });

    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/galeria');
      expect(res.status).toBe(401);
      expect(loadGallery).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/galeria', () => {
    const validItem = { url: 'https://cdn.test/a.jpg', tipo: 'image', titulo: 'Foto', descripcion: 'desc' };

    it('agrega un item con datos válidos y devuelve 201', async () => {
      const created = { id: 'g1', ...validItem, createdAt: '2026-01-01T00:00:00.000Z' };
      (addItem as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const res = await request(app)
        .post('/api/galeria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validItem);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(created);
      expect(addItem).toHaveBeenCalledWith('biz_1', expect.objectContaining({ url: validItem.url, tipo: 'image' }));
    });

    it('devuelve 400 si la URL no es http(s)', async () => {
      const res = await request(app)
        .post('/api/galeria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'ftp://cdn.test/a.jpg', tipo: 'image' });

      expect(res.status).toBe(400);
      expect(addItem).not.toHaveBeenCalled();
    });

    it('devuelve 400 si el tipo no es válido', async () => {
      const res = await request(app)
        .post('/api/galeria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://cdn.test/a.jpg', tipo: 'documento' });

      expect(res.status).toBe(400);
      expect(addItem).not.toHaveBeenCalled();
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .post('/api/galeria')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validItem);

      expect(res.status).toBe(403);
      expect(addItem).not.toHaveBeenCalled();
    });

    it('devuelve 401 sin token', async () => {
      const res = await request(app).post('/api/galeria').send(validItem);
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/galeria/:itemId', () => {
    it('elimina un item existente (ADMIN)', async () => {
      (removeItem as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/api/galeria/g1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(removeItem).toHaveBeenCalledWith('biz_1', 'g1');
    });

    it('devuelve 403 si el rol no es ADMIN', async () => {
      const res = await request(app)
        .delete('/api/galeria/g1')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(removeItem).not.toHaveBeenCalled();
    });
  });
});
