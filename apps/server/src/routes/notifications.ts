import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

const createNotificationSchema = z.object({
  type: z.enum(['BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_REMINDER', 'BOOKING_CANCELLED', 'ORDER_STATUS', 'PROMOTION', 'GENERAL']),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'TELEGRAM', 'SMS', 'PUSH']),
  title: z.string().min(1),
  body: z.string().min(1),
  userId: z.string(),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { unreadOnly } = req.query;
    const where: Record<string, unknown> = {
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
    };
    if (unreadOnly === 'true') where.isRead = false;

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await prisma.notification.count({
      where: { businessId: req.auth!.businessId, userId: req.auth!.userId, isRead: false },
    });

    res.json({ data: notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const data = createNotificationSchema.parse(req.body);
    const notification = await prisma.notification.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(notification);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, businessId: req.auth!.businessId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const notification = await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json(notification);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as notificationsRouter };
