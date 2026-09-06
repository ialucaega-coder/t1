import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { createBookingSchema, updateBookingStatusSchema, CreateBookingInput, UpdateBookingStatusInput } from '../validators/bookings';
import { paginationSchema, toSkipTake } from '../validators/common';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { date, status, professionalId, page, pageSize } = req.query;
    const pagination = paginationSchema.parse({ page, pageSize });
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (date) where.date = new Date(date as string);
    if (status) where.status = status;
    if (professionalId) where.professionalId = professionalId;

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, phone: true, email: true } },
          professional: { include: { user: { select: { name: true } } } },
          service: { select: { id: true, name: true, duration: true, price: true } },
        },
        orderBy: { startTime: 'asc' },
        ...toSkipTake(pagination),
      }),
      prisma.booking.count({ where }),
    ]);

    res.json({
      data: bookings,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.ceil(total / pagination.pageSize),
    });
  })
);

router.post(
  '/',
  requireAuth,
  validate(createBookingSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateBookingInput;
    const service = await prisma.service.findUnique({ where: { id: data.serviceId } });
    if (!service) {
      throw new AppError(404, 'Service not found');
    }

    const [hours, minutes] = data.startTime.split(':').map(Number);
    const endMinutes = hours * 60 + minutes + service.duration;
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

    const booking = await prisma.booking.create({
      data: {
        date: new Date(data.date),
        startTime: data.startTime,
        endTime,
        totalPrice: service.price,
        source: data.source,
        notes: data.notes,
        clientId: data.clientId || req.auth!.userId,
        professionalId: data.professionalId,
        serviceId: data.serviceId,
        businessId: req.auth!.businessId,
      },
      include: {
        client: { select: { name: true, phone: true } },
        professional: { include: { user: { select: { name: true } } } },
        service: { select: { name: true, duration: true } },
      },
    });

    getIO().to(`business:${req.auth!.businessId}`).emit('booking:created', { booking });
    res.status(201).json(booking);
  })
);

router.get(
  '/export/csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookings = await prisma.booking.findMany({
      where: { businessId: req.auth!.businessId },
      include: { service: true, professional: { include: { user: true } }, client: true },
      orderBy: { date: 'desc' },
      take: 5000,
    });

    const header = 'Fecha,Hora,Servicio,Profesional,Cliente,Email,Teléfono,Estado,Precio\n';
    const rows = bookings.map((b) =>
      [
        b.date.toISOString().split('T')[0],
        b.startTime,
        `"${(b.service?.name || '').replace(/"/g, '""')}"`,
        `"${(b.professional?.user?.name || '').replace(/"/g, '""')}"`,
        `"${(b.client?.name || '').replace(/"/g, '""')}"`,
        b.client?.email || '',
        b.client?.phone || '',
        b.status,
        b.service?.price?.toString() || '0',
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reservas.csv"');
    res.send('﻿' + header + rows);
  })
);

router.patch(
  '/:id/status',
  requireAuth,
  validate(updateBookingStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.body as UpdateBookingStatusInput;
    const booking = await prisma.booking.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data: { status },
    });
    getIO().to(`business:${req.auth!.businessId}`).emit('booking:updated', { booking });
    res.json(booking);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.booking.delete({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    res.status(204).send();
  })
);

export { router as bookingsRouter };
