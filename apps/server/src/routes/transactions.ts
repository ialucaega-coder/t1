import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createTransactionSchema, CreateTransactionInput } from '../validators/transactions';
import { paginationSchema, toSkipTake } from '../validators/common';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to, type, page, pageSize } = req.query;
    const pagination = paginationSchema.parse({ page, pageSize });
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
        ...toSkipTake(pagination),
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      data: transactions,
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
  requireRole('ADMIN'),
  validate(createTransactionSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateTransactionInput;
    const transaction = await prisma.transaction.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(transaction);
  })
);

export { router as transactionsRouter };
