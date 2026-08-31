import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

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
    const search = req.query.search as string | undefined;
    const where: any = { businessId: req.auth!.businessId };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const clients = await prisma.agencyClient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients);
  })
);

router.post(
  '/clients',
  requireAuth,
  requireRole('ADMIN'),
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
