import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { paginationSchema, toSkipTake } from '../validators/common';

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).default('whatsapp'),
  scheduledAt: z.string().datetime().optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['draft', 'scheduled', 'sent', 'cancelled']).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const where = { businessId: req.auth!.businessId };
    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(pagination),
      }),
      prisma.campaign.count({ where }),
    ]);
    res.json({ data: campaigns, total, page: pagination.page, pageSize: pagination.pageSize });
  })
);

router.get(
  '/recipients',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const channel = req.query.channel as string | undefined;

    const bookings = await prisma.booking.findMany({
      where: { businessId },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    const clientIds = bookings.map((b) => b.clientId);

    if (clientIds.length === 0) {
      return res.json({ total: 0, recipients: [] });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
    });

    const recipients = users.filter((u) => {
      if (!channel || channel === 'email') return !!u.email;
      if (channel === 'whatsapp' || channel === 'sms') return !!u.phone;
      return true;
    });

    res.json({ total: recipients.length, recipients });
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createCampaignSchema),
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
  validate(updateCampaignSchema),
  asyncHandler(async (req, res) => {
    const { name, description, status, channel, scheduledAt } = req.body;
    const upd = await prisma.campaign.updateMany({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data: { name, description, status, channel, scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = await prisma.campaign.findUnique({ where: { id: String(req.params.id) } });
    res.json(campaign);
  })
);

router.post(
  '/:id/send',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const campaign = await prisma.campaign.findFirst({
      where: { id, businessId: req.auth!.businessId },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');
    if (campaign.status === 'sent') throw new AppError(400, 'Campaign already sent');

    const bookings = await prisma.booking.findMany({
      where: { businessId: req.auth!.businessId },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    const recipientCount = bookings.length;

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        status: 'sent',
        sentCount: recipientCount,
        openRate: 0,
        clickRate: 0,
      },
    });

    getIO().to(`business:${req.auth!.businessId}`).emit('campaign:sent', { campaign: updated });

    res.json(updated);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.campaign.deleteMany({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.status(204).send();
  })
);

export const campaignsRouter = router;
