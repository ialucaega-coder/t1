/**
 * Pruebas de integración para los endpoints "bajo demanda" de superpoderes
 * (`src/routes/catalogFeatures.ts`, router de tipo 'superpower'):
 *   - GET /report      → "Reportes automáticos"
 *   - GET /reminders   → "Recordatorios inteligentes"
 *   - GET /analisis/:id→ "Analista IA"
 *   - GET /gaps        → "Auto-mejora"
 *
 * Auth REAL (JWT). Se mockean las capas de servicio (report, analysis, catalog)
 * y Prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: vi.fn() },
    message: { findMany: vi.fn() },
    skill: { findMany: vi.fn() },
  },
}));

vi.mock('../../services/superpowers/report', () => ({
  generateDailyReport: vi.fn(),
  generateReminders: vi.fn(),
}));

vi.mock('../../services/superpowers/analysis', () => ({
  analyzeConversation: vi.fn(),
  detectKnowledgeGaps: vi.fn(),
}));

vi.mock('../../services/catalog', () => ({
  ensureDefaultFeatures: vi.fn().mockResolvedValue(undefined),
  readFeatureConfig: vi.fn(() => ({ kind: 'superpower' })),
}));

import { prisma } from '../../lib/prisma';
import { generateDailyReport, generateReminders } from '../../services/superpowers/report';
import { analyzeConversation, detectKnowledgeGaps } from '../../services/superpowers/analysis';
import { createCatalogFeaturesRouter } from '../../routes/catalogFeatures';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const token = jwt.sign({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/superpowers', createCatalogFeaturesRouter('superpower'));
  app.use(errorHandler);
  return app;
}

describe('routes/catalogFeatures (superpowers)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/superpowers/report', () => {
    it('devuelve el reporte diario', async () => {
      (generateDailyReport as ReturnType<typeof vi.fn>).mockResolvedValue({ resumen: 'ok', reservas: 3 });

      const res = await request(app).get('/api/superpowers/report').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ resumen: 'ok', reservas: 3 });
      expect(generateDailyReport).toHaveBeenCalledWith('biz_1');
    });

    it('devuelve 401 sin token', async () => {
      const res = await request(app).get('/api/superpowers/report');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/superpowers/reminders', () => {
    it('devuelve los recordatorios', async () => {
      (generateReminders as ReturnType<typeof vi.fn>).mockResolvedValue([{ cliente: 'Ana' }]);

      const res = await request(app).get('/api/superpowers/reminders').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ cliente: 'Ana' }]);
    });
  });

  describe('GET /api/superpowers/analisis/:conversationId', () => {
    it('analiza una conversación con mensajes', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      (prisma.message.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'USER', text: 'Hola' },
        { role: 'BOT', text: 'Buenas' },
      ]);
      (analyzeConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        intencion: 'saludar', satisfaccion: 'alta', objeciones: [], siguientePaso: '', resumen: 'r',
      });

      const res = await request(app).get('/api/superpowers/analisis/c1').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.intencion).toBe('saludar');
      expect(analyzeConversation).toHaveBeenCalledWith('biz_1', expect.any(Array));
    });

    it('devuelve 404 si la conversación no existe', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).get('/api/superpowers/analisis/no-existe').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(analyzeConversation).not.toHaveBeenCalled();
    });

    it('devuelve 400 si la conversación no tiene mensajes', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      (prisma.message.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).get('/api/superpowers/analisis/c1').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('devuelve 503 si el proveedor de IA falla', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1' });
      (prisma.message.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ role: 'USER', text: 'Hola' }]);
      (analyzeConversation as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AI down'));

      const res = await request(app).get('/api/superpowers/analisis/c1').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(503);
    });
  });

  describe('GET /api/superpowers/gaps', () => {
    it('devuelve los huecos de conocimiento', async () => {
      (detectKnowledgeGaps as ReturnType<typeof vi.fn>).mockResolvedValue({
        analizadas: 10, conHuecos: 2, gaps: [], resumen: 'r',
      });

      const res = await request(app).get('/api/superpowers/gaps').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.analizadas).toBe(10);
      expect(detectKnowledgeGaps).toHaveBeenCalledWith('biz_1');
    });
  });
});
