import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createCategorySchema, updateCategorySchema, CreateCategoryInput, UpdateCategoryInput } from '../validators/categories';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { businessId: req.auth!.businessId },
      include: {
        _count: { select: { services: true, products: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(categories);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateCategoryInput;
    const category = await prisma.category.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(category);
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const data = req.body as UpdateCategoryInput;
    const category = await prisma.category.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data,
    });
    res.json(category);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.category.delete({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    res.status(204).send();
  })
);

export { router as categoriesRouter };
