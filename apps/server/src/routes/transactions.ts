import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createTransactionSchema, CreateTransactionInput } from '../validators/transactions';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to, type, page, pageSize } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };

    if (type) where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.createdAt as Record<string, unknown>).lte = new Date(to as string);
    }

    // Nueva paginación (?limit / ?offset): forma estándar { ...limit... }.
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const pagination = parsePagination(req.query);
      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.transaction.count({ where }),
      ]);
      return res.json(buildPaginatedResponse(transactions, total, pagination));
    }

    const pagination = paginationSchema.parse({ page, pageSize });
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

router.get(
  '/export/csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const txns = await prisma.transaction.findMany({
      where: { businessId: req.auth!.businessId },
      include: { order: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const header = 'Fecha,Tipo,Monto,Método de pago,Referencia,Notas,Orden\n';
    const rows = txns.map((t) =>
      [
        t.createdAt.toISOString().split('T')[0],
        t.type,
        t.amount.toString(),
        t.paymentMethod,
        `"${(t.reference || '').replace(/"/g, '""')}"`,
        `"${(t.notes || '').replace(/"/g, '""')}"`,
        t.order?.id || '',
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="movimientos.csv"');
    res.send('﻿' + header + rows);
  })
);

export { router as transactionsRouter };
