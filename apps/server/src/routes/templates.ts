import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { validate } from '../middleware/validate';

const router = Router();

const createTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  content: z.string().min(1),
  category: z.string().max(60).optional(),
  type: z.enum(['whatsapp', 'business']),
});

const updateTemplateSchema = createTemplateSchema.partial().omit({ type: true });

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (type && typeof type === 'string') where.type = type;

    const templates = await prisma.template.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(templates);
  })
);

router.post(
  '/',
  requireAuth,
  validate(createTemplateSchema),
  asyncHandler(async (req, res) => {
    const { name, description, content, category, type } = req.body;
    const template = await prisma.template.create({
      data: {
        name,
        description: description || null,
        content,
        category: category || null,
        type,
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(template);
  })
);

router.patch(
  '/:id',
  requireAuth,
  validate(updateTemplateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.template.findFirst({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    if (!existing) throw new AppError(404, 'Template not found');

    const { name, description, content, category } = req.body;
    const template = await prisma.template.update({
      where: { id: String(req.params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category }),
      },
    });
    res.json(template);
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.template.findFirst({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    if (!existing) throw new AppError(404, 'Template not found');

    await prisma.template.delete({ where: { id: String(req.params.id) } });
    res.status(204).send();
  })
);

export { router as templatesRouter };
