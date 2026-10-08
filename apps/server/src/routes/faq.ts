/**
 * Endpoints de la Base de conocimiento / FAQ del bot.
 *
 * GET  /api/faq  → lista de entradas del negocio.
 * PUT  /api/faq  → reemplaza la lista completa (la UI manda todo el set).
 *
 * El montaje en index.ts aplica requireAuth + requireCapability('bots') (la FAQ
 * es parte del área de Bots e IA). El servicio sanea y acota (ver services/faq).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  loadFaqItems,
  saveFaqItems,
  MAX_FAQ_ITEMS,
  MAX_QUESTION_LEN,
  MAX_ANSWER_LEN,
} from '../services/faq/config';

const router = Router();

const faqItemSchema = z.object({
  id: z.string().max(64).optional(),
  question: z.string().min(1).max(MAX_QUESTION_LEN),
  answer: z.string().min(1).max(MAX_ANSWER_LEN),
});

const replaceSchema = z.object({
  items: z.array(faqItemSchema).max(MAX_FAQ_ITEMS),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await loadFaqItems(req.auth!.businessId);
    res.json({ items });
  })
);

router.put(
  '/',
  validate(replaceSchema),
  asyncHandler(async (req, res) => {
    const items = await saveFaqItems(req.auth!.businessId, req.body.items);
    res.json({ items });
  })
);

export { router as faqRouter };
