import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

const createTransactionSchema = z.object({
  amount: z.number().positive(),
  type: z.enum(['SALE', 'REFUND', 'PARTIAL']).default('SALE'),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { from, to, type, page = '1', pageSize = '50' } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };

    if (type) where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.createdAt as Record<string, unknown>).lte = new Date(to as string);
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({ data: transactions, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const data = createTransactionSchema.parse(req.body);
    const transaction = await prisma.transaction.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(transaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as transactionsRouter };
