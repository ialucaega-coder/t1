import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const professionals = await prisma.professional.findMany({
      where: { businessId: req.auth!.businessId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        schedules: true,
        _count: { select: { bookings: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(professionals);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const professional = await prisma.professional.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        schedules: true,
        services: true,
        bookings: { take: 10, orderBy: { date: 'desc' }, include: { service: true, client: { select: { name: true } } } },
      },
    });
    if (!professional) {
      res.status(404).json({ error: 'Professional not found' });
      return;
    }
    res.json(professional);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/availability', requireAuth, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      res.status(400).json({ error: 'Date is required' });
      return;
    }

    const targetDate = new Date(date as string);
    const dayOfWeek = targetDate.getDay() === 0 ? 7 : targetDate.getDay();

    const schedule = await prisma.schedule.findFirst({
      where: { professionalId: req.params.id, dayOfWeek, isActive: true },
    });

    if (!schedule) {
      res.json({ available: false, slots: [] });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId: req.params.id,
        date: targetDate,
        status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] },
      },
      select: { startTime: true, endTime: true },
    });

    const [startH, startM] = schedule.startTime.split(':').map(Number);
    const [endH, endM] = schedule.endTime.split(':').map(Number);
    const slots: string[] = [];

    for (let m = startH * 60 + startM; m < endH * 60 + endM; m += 30) {
      const time = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
      const isBooked = bookings.some(b => {
        const bStart = b.startTime.split(':').map(Number);
        const bEnd = b.endTime.split(':').map(Number);
        const bStartMin = bStart[0] * 60 + bStart[1];
        const bEndMin = bEnd[0] * 60 + bEnd[1];
        return m >= bStartMin && m < bEndMin;
      });
      if (!isBooked) slots.push(time);
    }

    res.json({ available: true, schedule, slots });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as professionalsRouter };
