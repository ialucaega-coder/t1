import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createProductSchema, updateProductSchema, CreateProductInput, UpdateProductInput } from '../validators/products';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const products = await prisma.product.findMany({
      where: { businessId: req.auth!.businessId },
      include: { category: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(products);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateProductInput;
    const product = await prisma.product.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(product);
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as UpdateProductInput;
    const product = await prisma.product.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data,
    });
    res.json(product);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    await prisma.product.delete({ where: { id: product.id } });
    res.json({ success: true });
  })
);

export { router as productsRouter };
