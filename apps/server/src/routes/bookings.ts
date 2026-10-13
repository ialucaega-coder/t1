import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { createBookingSchema, updateBookingStatusSchema, CreateBookingInput, UpdateBookingStatusInput } from '../validators/bookings';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { sendBookingCreated, sendBookingConfirmed, sendBookingCancelled } from '../services/notifications';
import { syncBookingToCalcom } from '../services/calcom/sync';
import { dispatchEvent } from '../services/workflows';
import { createBooking } from '../services/bookings/create';

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
    // El motor de reservas (validación scoped + chequeo de conflictos + alta
    // atómica) vive en el servicio, reutilizado por las automatizaciones.
    const booking = await createBooking(req.auth!.businessId, data, req.auth!.userId);

    getIO()?.to(`business:${req.auth!.businessId}`).emit('booking:created', { booking });

    // Notifica al admin (in-app). Fire-and-forget: no debe romper la respuesta.
    void sendBookingCreated(booking).catch((err) =>
      console.error('[Bookings] Error notificando alta de reserva:', err)
    );

    // Dispara las automatizaciones del negocio para "nueva reserva". El modo
    // (simular vs ejecutar) lo resuelve dispatchEvent según el ajuste del
    // negocio; nunca lanza, así que no afecta la respuesta.
    void dispatchEvent(req.auth!.businessId, {
      trigger: 'nueva_reserva',
      payload: { clientId: booking.clientId, phone: booking.client?.phone ?? undefined },
    });

    // Sincroniza con Cal.com si el negocio lo tiene conectado. Best-effort:
    // no bloquea ni afecta la respuesta si Cal.com no está configurado o falla.
    void syncBookingToCalcom(req.auth!.businessId, {
      start: new Date(`${data.date}T${data.startTime}:00`),
      clientName: booking.client?.name,
      clientEmail: booking.client?.email,
    });

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
