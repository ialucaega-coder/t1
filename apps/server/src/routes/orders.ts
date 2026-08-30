import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

const createOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
  })).min(1),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']),
  clientId: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, page = '1', pageSize = '20' } = req.query;
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
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ data: orders, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const data = createOrderSchema.parse(req.body);

    const products = await prisma.product.findMany({
      where: { id: { in: data.items.map(i => i.productId) }, businessId: req.auth!.businessId },
    });

    if (products.length !== data.items.length) {
      res.status(400).json({ error: 'One or more products not found' });
      return;
    }

    const totalPrice = data.items.reduce((sum, item) => {
      const product = products.find(p => p.id === item.productId)!;
      return sum + product.price * item.quantity;
    }, 0);

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          totalPrice,
          notes: data.notes,
          clientId: data.clientId || req.auth!.userId,
          businessId: req.auth!.businessId,
          items: {
            create: data.items.map(item => {
              const product = products.find(p => p.id === item.productId)!;
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.update({
      where: { id: req.params.id, businessId: req.auth!.businessId },
      data: { status },
      include: { items: { include: { product: true } } },
    });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as ordersRouter };
