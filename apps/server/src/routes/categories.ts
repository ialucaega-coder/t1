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

/** Busca otra categoría del mismo negocio con el mismo nombre (sin distinguir mayúsculas). */
async function findDuplicateName(businessId: string, name: string, excludeId?: string) {
  return prisma.category.findFirst({
    where: {
      businessId,
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
}

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateCategoryInput;
    if (await findDuplicateName(req.auth!.businessId, data.name)) {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
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
    if (data.name && (await findDuplicateName(req.auth!.businessId, data.name, String(req.params.id)))) {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
    const category = await prisma.category.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data,
    });
    res.json(category);
  })
);

/**
 * DELETE /api/categories/:id
 *
 * Antes: se borraba la categoría sin mirar su contenido. La FK de la base es
 * ON DELETE SET NULL, así que los productos y servicios quedaban en silencio como
 * "Sin categoría" (huérfanos) y, si la categoría no era del negocio, se devolvía un
 * error de Prisma en vez de un 404.
 *
 * Ahora: si la categoría tiene productos o servicios se responde 409 con los
 * conteos y NO se borra nada. Para borrarla igual hay que pasar `?detach=true`
 * (decisión explícita): en una sola transacción se dejan esos productos/servicios
 * sin categoría y recién entonces se elimina. Todo con scope por businessId.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const id = String(req.params.id);
    const detach = req.query.detach === 'true';

    const category = await prisma.category.findFirst({
      where: { id, businessId },
      select: { id: true, _count: { select: { services: true, products: true } } },
    });
    if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

    const { services, products } = category._count;
    if ((services > 0 || products > 0) && !detach) {
      return res.status(409).json({
        error: `La categoría tiene ${products} producto${products !== 1 ? 's' : ''} y ${services} servicio${services !== 1 ? 's' : ''}. Movelos a otra categoría o confirmá que queden sin categoría.`,
        code: 'CATEGORY_IN_USE',
        products,
        services,
      });
    }

    await prisma.$transaction([
      prisma.product.updateMany({ where: { categoryId: id, businessId }, data: { categoryId: null } }),
      prisma.service.updateMany({ where: { categoryId: id, businessId }, data: { categoryId: null } }),
      prisma.category.deleteMany({ where: { id, businessId } }),
    ]);
    res.status(204).send();
  })
);

export { router as categoriesRouter };
