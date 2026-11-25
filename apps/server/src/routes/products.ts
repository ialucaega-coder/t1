import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { categoryBelongsToBusiness } from '../lib/catalog-category';
import { createProductSchema, updateProductSchema, CreateProductInput, UpdateProductInput } from '../validators/products';
import { isPaginationRequested, parsePagination, buildPaginatedResponse } from '../lib/pagination';

const router = Router();

/** Mensaje del 409 por edición sobre datos viejos (la UI lo reconoce para recargar). */
export const PRODUCT_STALE_MESSAGE = 'El producto cambió mientras lo editabas: recargá';

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    // deletedAt: null → los productos dados de baja (baja lógica) no se listan.
    const where = { businessId: req.auth!.businessId, deletedAt: null };
    const baseQuery = {
      where,
      include: { category: true },
      orderBy: { sortOrder: 'asc' as const },
    };

    // Retrocompatible: sin ?page/?limit/?offset devolvemos el array plano de siempre.
    if (!isPaginationRequested(req.query)) {
      const products = await prisma.product.findMany(baseQuery);
      return res.json(products);
    }

    // Con parámetros de paginación devolvemos la respuesta paginada estándar.
    const pagination = parsePagination(req.query);
    const [products, total] = await Promise.all([
      prisma.product.findMany({ ...baseQuery, skip: pagination.skip, take: pagination.take }),
      prisma.product.count({ where }),
    ]);
    res.json(buildPaginatedResponse(products, total, pagination));
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateProductInput;
    if (data.categoryId && !(await categoryBelongsToBusiness(req.auth!.businessId, data.categoryId))) {
      return res.status(400).json({ error: 'La categoría no existe' });
    }
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
    const { expectedUpdatedAt, ...data } = req.body as UpdateProductInput;
    const businessId = req.auth!.businessId;
    const id = String(req.params.id);
    if (data.categoryId && !(await categoryBelongsToBusiness(businessId, data.categoryId))) {
      return res.status(400).json({ error: 'La categoría no existe' });
    }

    // Update condicional y atómico: si viene expectedUpdatedAt, solo se aplica si el
    // producto sigue con ese updatedAt (una venta/edición concurrente lo cambia).
    // Así un PUT con stock absoluto viejo no pisa descuentos hechos mientras tanto.
    const { count } = await prisma.product.updateMany({
      where: {
        id,
        businessId,
        deletedAt: null,
        ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}),
      },
      data,
    });

    if (count === 0) {
      const exists = await prisma.product.findFirst({
        where: { id, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return res.status(404).json({ error: 'Producto no encontrado' });
      return res.status(409).json({ error: PRODUCT_STALE_MESSAGE, code: 'PRODUCT_STALE' });
    }

    const product = await prisma.product.findFirst({
      where: { id, businessId },
      include: { category: true },
    });
    res.json(product);
  })
);

/**
 * DELETE /api/products/:id → baja lógica (deletedAt + isActive=false). El borrado
 * físico fallaba con P2003 si el producto tenía ventas (OrderItem.product es
 * Restrict), así que un producto con historial no se podía quitar nunca. Con la
 * baja lógica el historial queda intacto y el producto deja de listarse.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { count } = await prisma.product.updateMany({
      where: { id: String(req.params.id), businessId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (count === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ success: true });
  })
);

export { router as productsRouter };
