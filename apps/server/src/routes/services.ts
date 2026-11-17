import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { categoryBelongsToBusiness } from '../lib/catalog-category';
import { createServiceSchema, updateServiceSchema, CreateServiceInput, UpdateServiceInput } from '../validators/services';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      // deletedAt: null → los servicios dados de baja (baja lógica) no se listan.
      where: { businessId: req.auth!.businessId, deletedAt: null },
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
    if (data.categoryId && !(await categoryBelongsToBusiness(req.auth!.businessId, data.categoryId))) {
      return res.status(400).json({ error: 'La categoría no existe' });
    }
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
    const businessId = req.auth!.businessId;
    const id = String(req.params.id);
    if (data.categoryId && !(await categoryBelongsToBusiness(businessId, data.categoryId))) {
      return res.status(400).json({ error: 'La categoría no existe' });
    }
    // No se edita un servicio dado de baja ni de otro negocio.
    const { count } = await prisma.service.updateMany({
      where: { id, businessId, deletedAt: null },
      data,
    });
    if (count === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    const service = await prisma.service.findFirst({ where: { id, businessId }, include: { category: true } });
    res.json(service);
  })
);

/**
 * DELETE /api/services/:id → baja lógica (deletedAt + isActive=false). El borrado
 * físico fallaba con P2003 si el servicio tenía reservas (Booking.service es
 * Restrict). Con la baja lógica el historial de reservas queda intacto.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { count } = await prisma.service.updateMany({
      where: { id: String(req.params.id), businessId: req.auth!.businessId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (count === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json({ success: true });
  })
);

export { router as servicesRouter };
