import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { paginationSchema, toSkipTake } from '../validators/common';
import { sendCampaign } from '../services/campaigns/send';

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).default('whatsapp'),
  scheduledAt: z.string().datetime().optional(),
});

const sendCampaignSchema = z.object({
  message: z.string().max(2000).optional(),
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

/** Tope de la vista previa de destinatarios (la UI solo usa `total`). */
const RECIPIENTS_PREVIEW_LIMIT = 50;

router.get(
  '/recipients',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const channel = req.query.channel as string | undefined;

    // Clientes del negocio con al menos una reserva y el dato de contacto que exige el
    // canal. El total se cuenta en la DB; solo se devuelve una vista previa acotada
    // (antes se traían TODOS los clientes a memoria y se filtraban en JS).
    const channelFilter: Prisma.UserWhereInput =
      !channel || channel === 'email'
        ? { NOT: { email: '' } }
        : channel === 'whatsapp' || channel === 'sms'
          ? { phone: { not: null }, NOT: { phone: '' } }
          : {};
    const where: Prisma.UserWhereInput = { bookingsAsClient: { some: { businessId } }, ...channelFilter };

    const [total, recipients] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, phone: true },
        orderBy: { name: 'asc' },
        take: RECIPIENTS_PREVIEW_LIMIT,
      }),
    ]);

    res.json({ total, recipients });
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
    const campaign = await prisma.campaign.findFirst({ where: { id: String(req.params.id), businessId: req.auth!.businessId } });
    res.json(campaign);
  })
);

router.post(
  '/:id/send',
  requireAuth,
  requireRole('ADMIN'),
  validate(sendCampaignSchema),
  asyncHandler(async (req, res) => {
    // La lógica vive en el servicio (reutilizada por las automatizaciones).
    const result = await sendCampaign(req.auth!.businessId, String(req.params.id), req.body.message);
    res.json(result);
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
