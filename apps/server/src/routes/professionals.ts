import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
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
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const professional = await prisma.professional.findUnique({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        schedules: true,
        services: true,
        bookings: { take: 10, orderBy: { date: 'desc' }, include: { service: true, client: { select: { name: true } } } },
      },
    });
    if (!professional) {
      throw new AppError(404, 'Professional not found');
    }
    res.json(professional);
  })
);

router.get(
  '/:id/availability',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'Date is required');
    }

    const targetDate = new Date(date as string);
    const dayOfWeek = targetDate.getDay() === 0 ? 7 : targetDate.getDay();

    const schedule = await prisma.schedule.findFirst({
      where: { professionalId: String(req.params.id), businessId: req.auth!.businessId, dayOfWeek, isActive: true },
    });

    if (!schedule) {
      res.json({ available: false, slots: [] });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId: String(req.params.id),
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
      const isBooked = bookings.some((b) => {
        const bStart = b.startTime.split(':').map(Number);
        const bEnd = b.endTime.split(':').map(Number);
        const bStartMin = bStart[0] * 60 + bStart[1];
        const bEndMin = bEnd[0] * 60 + bEnd[1];
        return m >= bStartMin && m < bEndMin;
      });
      if (!isBooked) slots.push(time);
    }

    res.json({ available: true, schedule, slots });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, email, phone, bio, specialties, serviceIds } = req.body;
    if (!name || !email) {
      throw new AppError(400, 'name and email are required');
    }

    const businessId = req.auth!.businessId;

    let user = await prisma.user.findFirst({ where: { email, businessId } });
    if (!user) {
      user = await prisma.user.create({
        data: { name, email, phone: phone || null, role: 'PROFESSIONAL', businessId, passwordHash: '' },
      });
    }

    const maxOrder = await prisma.professional.aggregate({
      where: { businessId },
      _max: { sortOrder: true },
    });

    const professional = await prisma.professional.create({
      data: {
        userId: user.id,
        businessId,
        bio: bio || null,
        specialties: specialties || [],
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        ...(serviceIds?.length ? { services: { connect: serviceIds.map((id: string) => ({ id })) } } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        schedules: true,
        _count: { select: { bookings: true } },
      },
    });

    res.status(201).json(professional);
  })
);

router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bio, specialties, isAvailable, serviceIds } = req.body;
    const businessId = req.auth!.businessId;

    const id = String(req.params.id);
    const existing = await prisma.professional.findUnique({
      where: { id, businessId },
    });
    if (!existing) throw new AppError(404, 'Professional not found');

    const updateData: any = {};
    if (bio !== undefined) updateData.bio = bio;
    if (specialties !== undefined) updateData.specialties = specialties;
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;

    if (serviceIds) {
      updateData.services = { set: serviceIds.map((sid: string) => ({ id: sid })) };
    }

    const professional = await prisma.professional.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        schedules: true,
        _count: { select: { bookings: true } },
      },
    });

    res.json(professional);
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const businessId = req.auth!.businessId;

    const existing = await prisma.professional.findUnique({
      where: { id, businessId },
      include: { _count: { select: { bookings: true } } },
    });
    if (!existing) throw new AppError(404, 'Professional not found');

    if (existing._count.bookings > 0) {
      await prisma.professional.update({
        where: { id },
        data: { isAvailable: false },
      });
      res.json({ message: 'Professional deactivated (has existing bookings)' });
      return;
    }

    await prisma.professional.delete({ where: { id } });
    res.status(204).send();
  })
);

export { router as professionalsRouter };
