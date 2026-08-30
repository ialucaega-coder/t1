import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createNotificationSchema, CreateNotificationInput } from '../validators/notifications';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
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
  })
);

router.post(
  '/',
  requireAuth,
  validate(createNotificationSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateNotificationInput;
    const notification = await prisma.notification.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(notification);
  })
);

router.patch(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, businessId: req.auth!.businessId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  })
);

router.patch(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data: { isRead: true },
    });
    res.json(notification);
  })
);

export { router as notificationsRouter };
