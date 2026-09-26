import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createOrderSchema, updateOrderStatusSchema, CreateOrderInput, UpdateOrderStatusInput } from '../validators/orders';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { sendOrderStatusUpdate, sendOrderCreated } from '../services/notifications';
import {
  IDEMP_TYPE_ORDER,
  readIdempotencyKey,
  idempotencyLockKey,
  findIdempotentEntityId,
  recordIdempotentKey,
} from '../lib/idempotency';

const router = Router();

const ORDER_INCLUDE = { items: { include: { product: true } }, client: true } as const;

/** Carga el pedido de una idempotency-key ya vista (o null). */
async function loadIdempotentOrder(
  db: Prisma.TransactionClient,
  businessId: string,
  key: string,
) {
  const orderId = await findIdempotentEntityId(db, businessId, IDEMP_TYPE_ORDER, key);
  if (!orderId) return null;
  return db.order.findFirst({ where: { id: orderId, businessId }, include: ORDER_INCLUDE });
}

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
    const businessId = req.auth!.businessId;
    const idempotencyKey = readIdempotencyKey(req.header('Idempotency-Key'));

    // Fast path: si ya procesamos esta clave, devolvemos el pedido existente sin
    // crear nada (idempotencia ante doble-submit o reintento de red).
    if (idempotencyKey) {
      const prior = await loadIdempotentOrder(prisma, businessId, idempotencyKey);
      if (prior) {
        res.status(200).json(prior);
        return;
      }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: data.items.map((i) => i.productId) }, businessId },
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

    const result = await prisma.$transaction(async (tx) => {
      // Con idempotency-key: serializamos duplicados concurrentes de la MISMA
      // clave con un advisory lock y re-chequeamos dentro de la transacción
      // (cierra la ventana entre el fast path y el create).
      if (idempotencyKey) {
        const lockKey = idempotencyLockKey(IDEMP_TYPE_ORDER, businessId, idempotencyKey);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const dup = await loadIdempotentOrder(tx, businessId, idempotencyKey);
        if (dup) return { order: dup, duplicated: true };
      }

      const newOrder = await tx.order.create({
        data: {
          totalPrice,
          notes: data.notes,
          clientId: data.clientId || req.auth!.userId,
          businessId,
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
        include: ORDER_INCLUDE,
      });

      await tx.transaction.create({
        data: {
          amount: totalPrice,
          type: 'SALE',
          paymentMethod: data.paymentMethod,
          reference: `ORD-${newOrder.id.slice(-8).toUpperCase()}`,
          businessId,
          orderId: newOrder.id,
        },
      });

      for (const item of data.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Registra la clave para deduplicar futuros reintentos.
      if (idempotencyKey) {
        await recordIdempotentKey(tx, businessId, IDEMP_TYPE_ORDER, idempotencyKey, newOrder.id);
      }

      return { order: newOrder, duplicated: false };
    });

    // Solo notificamos si es un pedido nuevo (no en el replay idempotente).
    if (!result.duplicated) {
      void sendOrderCreated(result.order).catch((err) =>
        console.error('[Orders] Error notificando alta de pedido:', err)
      );
    }

    res.status(result.duplicated ? 200 : 201).json(result.order);
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
