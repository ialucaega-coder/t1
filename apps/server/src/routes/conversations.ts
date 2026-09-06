import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, parseInt(req.query.pageSize as string) || 20);
    const status = req.query.status as string | undefined;
    const channel = req.query.channel as string | undefined;

    const where: any = { businessId: req.auth!.businessId };
    if (status) where.status = status;
    if (channel) where.channel = channel;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          bot: { select: { name: true, channel: true } },
          _count: { select: { messages: true } },
          messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { text: true, role: true, createdAt: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({ data: conversations, total, page, pageSize });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      include: {
        bot: { select: { name: true, channel: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  })
);

router.post(
  '/:id/reply',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'BOT',
        text: text.trim(),
      },
    });

    if (conversation.status === 'HANDOFF') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN' },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    getIO().to(`business:${conversation.businessId}`).emit('conversation:new-message', {
      conversationId: conversation.id,
      message,
    });

    res.json(message);
  })
);

router.patch(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await prisma.conversation.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId, status: 'OPEN' },
      data: { status: 'CLOSED' },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Conversation not found or already closed' });

    getIO().to(`business:${req.auth!.businessId}`).emit('conversation:closed', {
      conversationId: req.params.id,
    });

    res.json({ success: true });
  })
);

export const conversationsRouter = router;
