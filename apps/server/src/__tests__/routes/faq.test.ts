/**
 * Pruebas de integración de las rutas de Base de conocimiento / FAQ
 * (`src/routes/faq.ts`): GET lista las entradas del negocio, PUT reemplaza la
 * lista completa con validación Zod (longitudes y tope de cantidad). El servicio
 * de FAQ se mockea; el router asume que requireAuth ya inyectó req.auth (lo hace
 * el montaje en index.ts), así que acá se simula con un middleware.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../services/faq/config', () => ({
  MAX_FAQ_ITEMS: 100,
  MAX_QUESTION_LEN: 300,
  MAX_ANSWER_LEN: 1500,
  loadFaqItems: vi.fn(async () => [{ id: '1', question: '¿Horario?', answer: '9 a 18' }]),
  saveFaqItems: vi.fn(async (_businessId: string, items: Array<Record<string, unknown>>) =>
    items.map((it, i) => ({ id: String(i + 1), question: it.question, answer: it.answer }))
  ),
}));

import { faqRouter } from '../../routes/faq';
import { loadFaqItems, saveFaqItems } from '../../services/faq/config';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  });
  app.use('/api/faq', faqRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/faq', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/faq', () => {
    it('devuelve las entradas del negocio (scope por businessId)', async () => {
      const res = await request(app).get('/api/faq');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [{ id: '1', question: '¿Horario?', answer: '9 a 18' }] });
      expect(loadFaqItems).toHaveBeenCalledWith('biz_1');
    });
  });

  describe('PUT /api/faq', () => {
    it('reemplaza la lista completa y devuelve lo persistido', async () => {
      const res = await request(app)
        .put('/api/faq')
        .send({ items: [{ question: '¿Envíos?', answer: 'Sí, CABA' }] });

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ question: '¿Envíos?', answer: 'Sí, CABA' });
      expect(saveFaqItems).toHaveBeenCalledWith('biz_1', [{ question: '¿Envíos?', answer: 'Sí, CABA' }]);
    });

    it('acepta una lista vacía (borra todo)', async () => {
      const res = await request(app).put('/api/faq').send({ items: [] });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(saveFaqItems).toHaveBeenCalledWith('biz_1', []);
    });

    it('devuelve 400 si falta items (validación Zod)', async () => {
      const res = await request(app).put('/api/faq').send({});
      expect(res.status).toBe(400);
      expect(saveFaqItems).not.toHaveBeenCalled();
    });

    it('devuelve 400 con una pregunta vacía (validación Zod)', async () => {
      const res = await request(app).put('/api/faq').send({ items: [{ question: '', answer: 'a' }] });
      expect(res.status).toBe(400);
      expect(saveFaqItems).not.toHaveBeenCalled();
    });

    it('devuelve 400 si se supera el tope de cantidad', async () => {
      const items = Array.from({ length: 101 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
      const res = await request(app).put('/api/faq').send({ items });
      expect(res.status).toBe(400);
      expect(saveFaqItems).not.toHaveBeenCalled();
    });

    it('devuelve 400 si una respuesta excede el máximo', async () => {
      const res = await request(app)
        .put('/api/faq')
        .send({ items: [{ question: 'q', answer: 'a'.repeat(1501) }] });
      expect(res.status).toBe(400);
      expect(saveFaqItems).not.toHaveBeenCalled();
    });
  });
});
