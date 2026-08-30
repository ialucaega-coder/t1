import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createServiceSchema, updateServiceSchema, CreateServiceInput, UpdateServiceInput } from '../validators/services';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      where: { businessId: req.auth!.businessId },
      include: { category: true, professionals: { include: { user: { select: { name: true } } } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(services);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createServiceSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateServiceInput;
    const service = await prisma.service.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(service);
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateServiceSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as UpdateServiceInput;
    const service = await prisma.service.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data,
    });
    res.json(service);
  })
);

export { router as servicesRouter };
