import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createOrderSchema, updateOrderStatusSchema, CreateOrderInput, UpdateOrderStatusInput } from '../validators/orders';
import { paginationSchema, toSkipTake } from '../validators/common';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, page, pageSize } = req.query;
    const pagination = paginationSchema.parse({ page, pageSize });
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, phone: true } },
          items: { include: { product: { select: { name: true, price: true } } } },
        },
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
      include: { items: { include: { product: true } } },
    });
    res.json(order);
  })
);

export { router as ordersRouter };
