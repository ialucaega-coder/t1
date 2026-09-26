import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { createBookingSchema, updateBookingStatusSchema, CreateBookingInput, UpdateBookingStatusInput } from '../validators/bookings';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { sendBookingCreated, sendBookingConfirmed, sendBookingCancelled } from '../services/notifications';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { date, status, professionalId, page, pageSize } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (date) where.date = new Date(date as string);
    if (status) where.status = status;
    if (professionalId) where.professionalId = professionalId;

    // Evita N+1: cliente, profesional (con su user) y servicio en una sola query vía include.
    const include = {
      client: { select: { id: true, name: true, phone: true, email: true } },
      professional: { include: { user: { select: { name: true } } } },
      service: { select: { id: true, name: true, duration: true, price: true } },
    };

    // Nueva paginación (?limit / ?offset): forma estándar { ...limit... }.
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const pagination = parsePagination(req.query);
      const [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          include,
          orderBy: { startTime: 'asc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.booking.count({ where }),
      ]);
      return res.json(buildPaginatedResponse(bookings, total, pagination));
    }

    const pagination = paginationSchema.parse({ page, pageSize });
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include,
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
    // Scoped por negocio: evita reservar contra el servicio (precio/duración) de
    // otro tenant enviando un serviceId ajeno.
    const service = await prisma.service.findFirst({
      where: { id: data.serviceId, businessId: req.auth!.businessId },
    });
    if (!service) {
      throw new AppError(404, 'Service not found');
    }

    // Anti cross-tenant: si viene un clientId explícito, debe pertenecer al negocio.
    // Evita que se cree (y luego se notifique a) un cliente de otro negocio.
    if (data.clientId && data.clientId !== req.auth!.userId) {
      const client = await prisma.user.findFirst({
        where: { id: data.clientId, businessId: req.auth!.businessId },
        select: { id: true },
      });
      if (!client) throw new AppError(404, 'Cliente no encontrado en este negocio');
    }

    const [hours, minutes] = data.startTime.split(':').map(Number);
    const endMinutes = hours * 60 + minutes + service.duration;
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

    // Reserva atómica también en el panel: mismo advisory lock por
    // (negocio, profesional, día) + re-chequeo de solape dentro de la
    // transacción. Evita agendar dos turnos del mismo profesional a la misma
    // hora (físicamente imposible). Sin profesional asignado no hay recurso que
    // colisione, así que se omite el chequeo.
    const lockKey = `booking:${req.auth!.businessId}:${data.professionalId ?? ''}:${data.date}`;
    const booking = await prisma.$transaction(async (tx) => {
      if (data.professionalId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const sameDay = await tx.booking.findMany({
          where: {
            businessId: req.auth!.businessId,
            professionalId: data.professionalId,
            date: new Date(data.date),
            status: { notIn: ['CANCELLED'] },
          },
          select: { startTime: true, endTime: true },
        });
        if (sameDay.some((b) => data.startTime < b.endTime && endTime > b.startTime)) {
          return null;
        }
      }

      return tx.booking.create({
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
    });

    if (!booking) {
      throw new AppError(409, 'Ese horario ya está reservado para el profesional.');
    }

    getIO()?.to(`business:${req.auth!.businessId}`).emit('booking:created', { booking });

    // Notifica al admin (in-app). Fire-and-forget: no debe romper la respuesta.
    void sendBookingCreated(booking).catch((err) =>
      console.error('[Bookings] Error notificando alta de reserva:', err)
    );

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
      include: {
        client: { select: { name: true } },
        service: { select: { name: true } },
      },
    });
    getIO()?.to(`business:${req.auth!.businessId}`).emit('booking:updated', { booking });

    // Notifica al cliente por su mejor canal (WhatsApp/email). Fire-and-forget.
    if (status === 'CONFIRMED') {
      void sendBookingConfirmed(booking).catch((err) =>
        console.error('[Bookings] Error notificando confirmación:', err)
      );
    } else if (status === 'CANCELLED') {
      void sendBookingCancelled(booking).catch((err) =>
        console.error('[Bookings] Error notificando cancelación:', err)
      );
    }

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
