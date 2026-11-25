import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { loadGallery, addItem, removeItem } from '../services/gallery/config';

const router = Router();

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url('La URL no es válida')
  .refine((v) => /^https?:\/\//i.test(v), 'La URL debe comenzar con http:// o https://');

const createItemSchema = z.object({
  url: httpUrl,
  tipo: z.enum(['image', 'video', 'audio']),
  titulo: z.string().trim().max(120).optional().default(''),
  descripcion: z.string().trim().max(500).optional().default(''),
});

type CreateItemInput = z.infer<typeof createItemSchema>;

// GET /api/galeria — lista los items de la galería del negocio
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await loadGallery(req.auth!.businessId);
    res.json(items);
  })
);

// POST /api/galeria — agrega un item (solo ADMIN)
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createItemSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateItemInput;
    const item = await addItem(req.auth!.businessId, data);
    res.status(201).json(item);
  })
);

// DELETE /api/galeria/:itemId — elimina un item (solo ADMIN)
router.delete(
  '/:itemId',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await removeItem(req.auth!.businessId, String(req.params.itemId));
    res.json({ success: true });
  })
);

export { router as galeriaRouter };
