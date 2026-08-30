import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';
const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const where: Record<string, unknown> = {
      businessId: req.auth!.businessId,
      role: 'CLIENT',
    };

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
      ];
    }

    const clients = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        bookingsAsClient: {
          orderBy: { date: 'desc' },
          take: 1,
          select: { date: true },
        },
        _count: { select: { bookingsAsClient: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(clients);
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as clientsRouter };
