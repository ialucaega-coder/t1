import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { paginationSchema, toSkipTake } from '../validators/common';

const createAgencyClientSchema = z.object({
  name: z.string().min(1).max(200),
  plan: z.string().max(50).optional(),
  status: z.enum(['active', 'trial', 'inactive', 'churned']).optional(),
});

const updateAgencyClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  plan: z.string().max(50).optional(),
  status: z.enum(['active', 'trial', 'inactive', 'churned']).optional(),
  bots: z.number().int().min(0).optional(),
  revenue: z.number().min(0).optional(),
});

const router = Router();

router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const [totalClients, activeBots] = await Promise.all([
      prisma.agencyClient.count({ where: { businessId } }),
      prisma.agencyClient.aggregate({ where: { businessId }, _sum: { bots: true } }),
    ]);
    const activeClients = await prisma.agencyClient.count({ where: { businessId, status: 'active' } });
    const totalRevenue = await prisma.agencyClient.aggregate({ where: { businessId }, _sum: { revenue: true } });
    res.json({
      totalBusinesses: totalClients,
      totalBots: activeBots._sum.bots || 0,
      totalRevenue: `$${(totalRevenue._sum.revenue || 0).toLocaleString()}`,
      activeClients,
      referralCode: `LB-${businessId.slice(-6).toUpperCase()}`,
      referralLink: `https://localb.com/ref/${businessId.slice(-6)}`,
      commission: '20%',
    });
  })
);

router.get(
  '/clients',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const search = req.query.search as string | undefined;
    const where: Prisma.AgencyClientWhereInput = { businessId: req.auth!.businessId };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [clients, total] = await Promise.all([
      prisma.agencyClient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(pagination),
      }),
      prisma.agencyClient.count({ where }),
    ]);
    res.json({ data: clients, total, page: pagination.page, pageSize: pagination.pageSize });
  })
);

router.post(
  '/clients',
  requireAuth,
  requireRole('ADMIN'),
  validate(createAgencyClientSchema),
  asyncHandler(async (req, res) => {
    const { name, plan, status } = req.body;
    const client = await prisma.agencyClient.create({
      data: {
        name,
        plan: plan || 'Free',
        status: status || 'trial',
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(client);
  })
);

router.patch(
  '/clients/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateAgencyClientSchema),
  asyncHandler(async (req, res) => {
    const { name, plan, status, bots, revenue } = req.body;
    const upd = await prisma.agencyClient.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { name, plan, status, bots, revenue },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Client not found' });
    const client = await prisma.agencyClient.findUnique({ where: { id: req.params.id as string } });
    res.json(client);
  })
);

router.delete(
  '/clients/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.agencyClient.deleteMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Client not found' });
    res.status(204).send();
  })
);

export const agencyRouter = router;
