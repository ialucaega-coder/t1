import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/overview', requireAuth, async (req, res) => {
  try {
    const businessId = req.auth!.businessId;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      todayBookings,
      monthBookings,
      lastMonthBookings,
      totalClients,
      monthRevenue,
      lastMonthRevenue,
      activeServices,
      totalProducts,
      noShows,
      lastMonthNoShows,
    ] = await Promise.all([
      prisma.booking.count({ where: { businessId, date: { gte: startOfDay } } }),
      prisma.booking.count({ where: { businessId, date: { gte: startOfMonth } } }),
      prisma.booking.count({ where: { businessId, date: { gte: startOfLastMonth, lt: startOfMonth } } }),
      prisma.user.count({ where: { businessId, role: 'CLIENT' } }),
      prisma.transaction.aggregate({ where: { businessId, createdAt: { gte: startOfMonth }, type: 'SALE' }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { businessId, createdAt: { gte: startOfLastMonth, lt: startOfMonth }, type: 'SALE' }, _sum: { amount: true } }),
      prisma.service.count({ where: { businessId, isActive: true } }),
      prisma.product.count({ where: { businessId } }),
      prisma.booking.count({ where: { businessId, status: 'NO_SHOW', date: { gte: startOfMonth } } }),
      prisma.booking.count({ where: { businessId, status: 'NO_SHOW', date: { gte: startOfLastMonth, lt: startOfMonth } } }),
    ]);

    const currentRevenue = monthRevenue._sum.amount || 0;
    const prevRevenue = lastMonthRevenue._sum.amount || 0;
    const revenueChange = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : '0';
    const bookingChange = lastMonthBookings > 0 ? ((monthBookings - lastMonthBookings) / lastMonthBookings * 100).toFixed(1) : '0';
    const noShowRate = monthBookings > 0 ? ((noShows / monthBookings) * 100).toFixed(1) : '0';
    const lastNoShowRate = lastMonthBookings > 0 ? ((lastMonthNoShows / lastMonthBookings) * 100).toFixed(1) : '0';

    res.json({
      todayBookings,
      monthBookings,
      bookingChange: `${Number(bookingChange) >= 0 ? '+' : ''}${bookingChange}%`,
      totalClients,
      revenue: currentRevenue,
      revenueChange: `${Number(revenueChange) >= 0 ? '+' : ''}${revenueChange}%`,
      activeServices,
      totalProducts,
      noShowRate: `${noShowRate}%`,
      noShowChange: `${Number(noShowRate) <= Number(lastNoShowRate) ? '-' : '+'}${Math.abs(Number(noShowRate) - Number(lastNoShowRate)).toFixed(1)}%`,
    });
  } catch (error) {
    console.error('Stats overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/weekly', requireAuth, async (req, res) => {
  try {
    const businessId = req.auth!.businessId;
    const now = new Date();
    const days = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const [bookings, revenue] = await Promise.all([
        prisma.booking.count({ where: { businessId, date: { gte: start, lt: end } } }),
        prisma.transaction.aggregate({ where: { businessId, createdAt: { gte: start, lt: end }, type: 'SALE' }, _sum: { amount: true } }),
      ]);

      days.push({
        date: start.toISOString().split('T')[0],
        day: start.toLocaleDateString('es-AR', { weekday: 'short' }),
        bookings,
        revenue: revenue._sum.amount || 0,
      });
    }

    res.json(days);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/top-services', requireAuth, async (req, res) => {
  try {
    const businessId = req.auth!.businessId;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const services = await prisma.booking.groupBy({
      by: ['serviceId'],
      where: { businessId, date: { gte: startOfMonth } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    const serviceDetails = await prisma.service.findMany({
      where: { id: { in: services.map(s => s.serviceId) } },
      select: { id: true, name: true },
    });

    const result = services.map(s => ({
      ...serviceDetails.find(d => d.id === s.serviceId),
      bookingCount: s._count.id,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as statsRouter };
