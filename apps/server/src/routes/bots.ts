import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { paginationSchema, toSkipTake } from '../validators/common';

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  channel: z.enum(['TELEGRAM', 'WHATSAPP', 'WEB']).default('TELEGRAM'),
  config: z.record(z.unknown()).optional(),
});

const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  channel: z.enum(['TELEGRAM', 'WHATSAPP', 'WEB']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
  config: z.record(z.unknown()).optional(),
  token: z.string().max(500).optional(),
  webhookUrl: z.string().url().max(500).optional(),
});

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const where = { businessId: req.auth!.businessId };
    const [bots, total] = await Promise.all([
      prisma.bot.findMany({
        where,
        include: { _count: { select: { conversations: true } } },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(pagination),
      }),
      prisma.bot.count({ where }),
    ]);
    res.json({ data: bots, total, page: pagination.page, pageSize: pagination.pageSize });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bot = await prisma.bot.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      include: {
        _count: { select: { conversations: true } },
        conversations: { take: 10, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { messages: true } } } },
      },
    });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json(bot);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createBotSchema),
  asyncHandler(async (req, res) => {
    const { name, description, channel, config } = req.body;
    const bot = await prisma.bot.create({
      data: {
        name,
        description,
        channel: channel || 'TELEGRAM',
        config,
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(bot);
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateBotSchema),
  asyncHandler(async (req, res) => {
    const { name, description, channel, status, config, token, webhookUrl } = req.body;
    const bot = await prisma.bot.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { name, description, channel, status, config, token, webhookUrl },
    });
    if (bot.count === 0) return res.status(404).json({ error: 'Bot not found' });
    const updated = await prisma.bot.findUnique({ where: { id: req.params.id as string } });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.bot.deleteMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Bot not found' });
    res.status(204).send();
  })
);

router.get(
  '/:id/conversations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, parseInt(req.query.pageSize as string) || 20);
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { botId: req.params.id as string, businessId: req.auth!.businessId },
        include: { _count: { select: { messages: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.conversation.count({ where: { botId: req.params.id as string, businessId: req.auth!.businessId } }),
    ]);
    res.json({ data: conversations, total, page, pageSize });
  })
);

export const botsRouter = router;
