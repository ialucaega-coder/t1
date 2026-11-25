import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { paginationSchema, toSkipTake } from '../validators/common';
import { sendCampaign } from '../services/campaigns/send';

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).default('whatsapp'),
  scheduledAt: z.string().datetime().optional(),
});

/** Margen para tolerar el desfase de reloj del cliente al programar "ya". */
const SCHEDULE_SKEW_MS = 60_000;

function assertFuture(scheduledAt: string): Date {
  const when = new Date(scheduledAt);
  if (when.getTime() < Date.now() - SCHEDULE_SKEW_MS) {
    throw new AppError(400, 'La fecha programada tiene que ser futura');
  }
  return when;
}

const sendCampaignSchema = z.object({
  message: z.string().max(2000).optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  // 'sent' y 'sending' los fija el motor de envío: un PATCH no puede marcar una campaña como enviada.
  status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).optional(),
  // null = quitar la programación (vuelve a borrador).
  scheduledAt: z.string().datetime().nullable().optional(),
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
    // Con fecha, nace 'scheduled': el scheduler la envía al vencer (services/campaigns/dispatch).
    const when = scheduledAt ? assertFuture(scheduledAt) : null;
    const campaign = await prisma.campaign.create({
      data: {
        name,
        description,
        channel: channel || 'whatsapp',
        scheduledAt: when,
        status: when ? 'scheduled' : 'draft',
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
    const businessId = req.auth!.businessId;
    const id = String(req.params.id);

    const existing = await prisma.campaign.findFirst({ where: { id, businessId }, select: { status: true } });
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    if (existing.status === 'sent' || existing.status === 'sending') {
      throw new AppError(400, 'La campaña ya fue enviada o se está enviando');
    }

    // Programar / reprogramar / desprogramar mantiene el estado coherente:
    // con fecha → 'scheduled'; sin fecha (null) → vuelve a 'draft'. Un status
    // explícito (p. ej. 'cancelled') manda sobre el automático.
    let nextStatus: string | undefined = status;
    let nextWhen: Date | null | undefined;
    if (scheduledAt) {
      nextWhen = assertFuture(scheduledAt);
      if (!nextStatus && existing.status !== 'cancelled') nextStatus = 'scheduled';
    } else if (scheduledAt === null) {
      nextWhen = null;
      if (!nextStatus && existing.status === 'scheduled') nextStatus = 'draft';
    }
    if (nextStatus === 'scheduled') {
      // Pasar a 'scheduled' sin fecha nunca se enviaría: exigimos la fecha, también si
      // el body trae `scheduledAt: null` (antes quedaba 'scheduled' con fecha nula).
      if (nextWhen === null) throw new AppError(400, 'Para programar la campaña indicá la fecha');
      if (nextWhen === undefined) {
        const row = await prisma.campaign.findFirst({ where: { id, businessId }, select: { scheduledAt: true } });
        if (!row?.scheduledAt) throw new AppError(400, 'Para programar la campaña indicá la fecha');
      }
    }

    const upd = await prisma.campaign.updateMany({
      where: { id, businessId, status: { notIn: ['sent', 'sending'] } },
      data: { name, description, status: nextStatus, channel, scheduledAt: nextWhen },
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
    const id = String(req.params.id);
    const businessId = req.auth!.businessId;
    // No se borra una campaña que se está enviando: el job seguiría mandando mensajes
    // sin campaña a la que reportar. La condición va en el propio DELETE (atómica).
    const del = await prisma.campaign.deleteMany({ where: { id, businessId, status: { not: 'sending' } } });
    if (del.count === 0) {
      const current = await prisma.campaign.findFirst({ where: { id, businessId }, select: { status: true } });
      if (current?.status === 'sending') {
        throw new AppError(409, 'La campaña se está enviando: esperá a que termine para eliminarla');
      }
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.status(204).send();
  })
);

export const campaignsRouter = router;
