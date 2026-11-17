import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createTransactionSchema, CreateTransactionInput } from '../validators/transactions';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import {
  IDEMP_TYPE_TRANSACTION,
  readIdempotencyKey,
  idempotencyLockKey,
  findIdempotentEntityId,
  recordIdempotentKey,
} from '../lib/idempotency';
import { dispatchEvent } from '../services/workflows';

const router = Router();

/**
 * Filtros compartidos por el listado y el resumen. Siempre acotados al negocio
 * del usuario autenticado. `type` es el tipo de movimiento (SALE/REFUND/PARTIAL)
 * y `paymentMethod` el método de cobro (CASH/CARD/TRANSFER/QR): son campos
 * distintos y no deben mezclarse.
 */
const transactionFiltersSchema = z.object({
  type: z.enum(['SALE', 'REFUND', 'PARTIAL']).optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

function buildTransactionWhere(businessId: string, query: Record<string, unknown>) {
  const { type, paymentMethod, from, to } = transactionFiltersSchema.parse({
    type: query.type || undefined,
    paymentMethod: query.paymentMethod || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
  });
  const where: Record<string, unknown> = { businessId };

  if (type) where.type = type;
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.gte = new Date(from);
    if (to) createdAt.lte = new Date(to);
    where.createdAt = createdAt;
  }
  return where;
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize } = req.query;
    const where = buildTransactionWhere(req.auth!.businessId, req.query);

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

/**
 * Totales reales (no de la página cargada) con los mismos filtros que el
 * listado. Devuelve montos y cantidad por tipo, y el neto (ventas + parciales
 * - reembolsos).
 */
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = buildTransactionWhere(req.auth!.businessId, req.query);
    const groups = await prisma.transaction.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });

    const totalOf = (t: string) => Number(groups.find((g) => g.type === t)?._sum.amount ?? 0);
    const countOf = (t: string) => groups.find((g) => g.type === t)?._count._all ?? 0;

    const sales = totalOf('SALE');
    const partial = totalOf('PARTIAL');
    const refunds = totalOf('REFUND');

    res.json({
      sales,
      partial,
      refunds,
      net: sales + partial - refunds,
      count: groups.reduce((s, g) => s + g._count._all, 0),
      counts: { SALE: countOf('SALE'), PARTIAL: countOf('PARTIAL'), REFUND: countOf('REFUND') },
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
    const businessId = req.auth!.businessId;
    const idempotencyKey = readIdempotencyKey(req.header('Idempotency-Key'));

    // Idempotencia: un doble-submit del cobro (doble click / reintento) no debe
    // duplicar el movimiento contable. Es el path real del POS (PaymentModal).
    if (idempotencyKey) {
      const priorId = await findIdempotentEntityId(prisma, businessId, IDEMP_TYPE_TRANSACTION, idempotencyKey);
      if (priorId) {
        const prior = await prisma.transaction.findFirst({ where: { id: priorId, businessId } });
        if (prior) {
          res.status(200).json(prior);
          return;
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const lockKey = idempotencyLockKey(IDEMP_TYPE_TRANSACTION, businessId, idempotencyKey);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const dupId = await findIdempotentEntityId(tx, businessId, IDEMP_TYPE_TRANSACTION, idempotencyKey);
        if (dupId) {
          const dup = await tx.transaction.findFirst({ where: { id: dupId, businessId } });
          if (dup) return { txn: dup, duplicated: true };
        }
      }

      const created = await tx.transaction.create({ data: { ...data, businessId } });
      if (idempotencyKey) {
        await recordIdempotentKey(tx, businessId, IDEMP_TYPE_TRANSACTION, idempotencyKey, created.id);
      }
      return { txn: created, duplicated: false };
    });

    // Dispara "pago recibido" solo para cobros reales (venta total o parcial),
    // nunca para devoluciones (REFUND = salida de dinero) ni para duplicados por
    // idempotencia. Fire-and-forget: el modo lo resuelve el negocio y no lanza.
    if (!result.duplicated && (result.txn.type === 'SALE' || result.txn.type === 'PARTIAL')) {
      void dispatchEvent(businessId, {
        trigger: 'pago_recibido',
        payload: {
          transactionId: result.txn.id,
          amount: Number(result.txn.amount),
          paymentMethod: result.txn.paymentMethod,
          orderId: result.txn.orderId ?? undefined,
        },
      });
    }

    res.status(result.duplicated ? 200 : 201).json(result.txn);
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
