import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { listClientsQuerySchema } from '../validators/clients';
import { toSkipTake } from '../validators/common';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listClientsQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {
      businessId: req.auth!.businessId,
      role: 'CLIENT',
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
      ];
    }

    const [clients, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          bookingsAsClient: {
            orderBy: { date: 'desc' },
            take: 1,
            select: { date: true },
          },
          _count: { select: { bookingsAsClient: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      data: clients,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    });
  })
);

export { router as clientsRouter };
