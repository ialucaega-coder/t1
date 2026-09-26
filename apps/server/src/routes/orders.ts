import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createOrderSchema, updateOrderStatusSchema, CreateOrderInput, UpdateOrderStatusInput } from '../validators/orders';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { sendOrderStatusUpdate, sendOrderCreated } from '../services/notifications';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, page, pageSize } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (status) where.status = status;

    // Evita N+1: cliente e items (con su producto) vienen en una sola query vía include.
    const include = {
      client: { select: { id: true, name: true, phone: true } },
      items: { include: { product: { select: { name: true, price: true } } } },
    };

    // Nueva paginación (?limit / ?offset): forma estándar { ...limit... }.
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const pagination = parsePagination(req.query);
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.order.count({ where }),
      ]);
      return res.json(buildPaginatedResponse(orders, total, pagination));
    }

    const pagination = paginationSchema.parse({ page, pageSize });
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(pagination),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      data: orders,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.ceil(total / pagination.pageSize),
    });
  })
);

router.post(
  '/',
  requireAuth,
  validate(createOrderSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateOrderInput;

    const products = await prisma.product.findMany({
      where: { id: { in: data.items.map((i) => i.productId) }, businessId: req.auth!.businessId },
    });

    if (products.length !== data.items.length) {
      throw new AppError(400, 'One or more products not found');
    }

    // Anti cross-tenant: si viene un clientId explícito, debe pertenecer al negocio.
    // Evita que se asocie (y luego se notifique a) un cliente de otro negocio.
    if (data.clientId && data.clientId !== req.auth!.userId) {
      const client = await prisma.user.findFirst({
        where: { id: data.clientId, businessId: req.auth!.businessId },
        select: { id: true },
      });
      if (!client) throw new AppError(404, 'Cliente no encontrado en este negocio');
    }

    const totalPrice = data.items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return sum + Number(product.price) * item.quantity;
    }, 0);

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          totalPrice,
          notes: data.notes,
          clientId: data.clientId || req.auth!.userId,
          businessId: req.auth!.businessId,
          items: {
            create: data.items.map((item) => {
              const product = products.find((p) => p.id === item.productId)!;
              return {
                productId: item.productId,
                quantity: item.quantity,
                price: product.price,
              };
            }),
          },
        },
        include: { items: { include: { product: true } }, client: true },
      });

      await tx.transaction.create({
        data: {
          amount: totalPrice,
          type: 'SALE',
          paymentMethod: data.paymentMethod,
          reference: `ORD-${newOrder.id.slice(-8).toUpperCase()}`,
          businessId: req.auth!.businessId,
        },
      });

      for (const item of data.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      return newOrder;
    });

    // Notifica al admin el nuevo pedido (in-app). Fire-and-forget.
    void sendOrderCreated(order).catch((err) =>
      console.error('[Orders] Error notificando alta de pedido:', err)
    );

    res.status(201).json(order);
  })
);

router.patch(
  '/:id/status',
  requireAuth,
  validate(updateOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.body as UpdateOrderStatusInput;
    const order = await prisma.order.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data: { status },
      include: {
        items: { include: { product: true } },
        client: { select: { name: true } },
      },
    });

    // Notifica al cliente el nuevo estado por su mejor canal. Fire-and-forget.
    void sendOrderStatusUpdate(order).catch((err) =>
      console.error('[Orders] Error notificando estado de pedido:', err)
    );

    res.json(order);
  })
);

export { router as ordersRouter };
