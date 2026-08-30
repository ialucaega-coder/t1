import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createNotificationSchema, CreateNotificationInput } from '../validators/notifications';

const router = Router();

// GET /api/notifications — Listar notificaciones (paginadas, filtrables por isRead)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { unreadOnly, page = '1', pageSize = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const size = Math.min(50, Math.max(1, parseInt(pageSize as string, 10) || 20));

    const where: Record<string, unknown> = {
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
    };
    if (unreadOnly === 'true') where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { businessId: req.auth!.businessId, userId: req.auth!.userId, isRead: false },
      }),
    ]);

    res.json({
      data: notifications,
      unreadCount,
      total,
      page: pageNum,
      pageSize: size,
      totalPages: Math.ceil(total / size),
    });
  })
);

// GET /api/notifications/unread-count — Obtener cantidad de no leídas
router.get(
  '/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({
      where: {
        businessId: req.auth!.businessId,
        userId: req.auth!.userId,
        isRead: false,
      },
    });
    res.json({ unreadCount: count });
  })
);

// POST /api/notifications — Crear notificación
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

// PUT /api/notifications/read-all — Marcar todas como leídas
router.put(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, businessId: req.auth!.businessId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  })
);

// PATCH /api/notifications/read-all — Alias (compatibilidad)
router.patch(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, businessId: req.auth!.businessId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  })
);

// PUT /api/notifications/:id/read — Marcar una como leída
router.put(
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

// PATCH /api/notifications/:id/read — Alias (compatibilidad)
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
