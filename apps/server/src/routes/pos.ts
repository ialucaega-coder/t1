import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

router.get(
  '/items',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    const [services, products] = await Promise.all([
      prisma.service.findMany({
        where: { businessId, isActive: true },
        select: { name: true, price: true },
        orderBy: { name: 'asc' },
      }),
      prisma.product.findMany({
        where: { businessId, stock: { gt: 0 } },
        select: { name: true, price: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const items = [
      ...services.map((s) => ({ name: s.name, price: Number(s.price) })),
      ...products.map((p) => ({ name: p.name, price: Number(p.price) })),
    ];

    res.json(items);
  })
);

export { router as posRouter };
