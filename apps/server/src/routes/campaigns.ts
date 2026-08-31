import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaigns = await prisma.campaign.findMany({
      where: { businessId: req.auth!.businessId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { name, description, channel, scheduledAt } = req.body;
    const campaign = await prisma.campaign.create({
      data: {
        name,
        description,
        channel: channel || 'whatsapp',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(campaign);
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { name, description, status, channel, scheduledAt } = req.body;
    const upd = await prisma.campaign.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { name, description, status, channel, scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id as string } });
    res.json(campaign);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.campaign.deleteMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.status(204).send();
  })
);

export const campaignsRouter = router;
