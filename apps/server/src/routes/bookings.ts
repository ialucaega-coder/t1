import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { createBookingSchema, updateBookingSchema, updateBookingStatusSchema, CreateBookingInput, UpdateBookingInput, UpdateBookingStatusInput } from '../validators/bookings';
import { paginationSchema, toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { queueNotification } from '../services/notifications';
import { syncBookingToCalcom } from '../services/calcom/sync';
import { dispatchEvent } from '../services/workflows';
import { createBooking } from '../services/bookings/create';
import { updateBooking } from '../services/bookings/update';
import { FINAL_BOOKING_STATUSES, bookingDateKey, bookingInstant } from '../services/bookings/time';
import { csvCell } from '../services/bookings/csv';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { date, status, professionalId, page, pageSize } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    // Fecha inválida => 400 (antes pasaba un Invalid Date a Prisma y daba 500).
    if (date) where.date = new Date(bookingDateKey(String(date)));
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

    // Notifica al admin (in-app) por la cola de avisos (con reintentos, jobId
    // idempotente). Sin await: no debe demorar ni romper la respuesta.
    void queueNotification({ event: 'booking-created', id: booking.id, businessId: req.auth!.businessId });

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
      start: bookingInstant(data.date, data.startTime),
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
        // Celdas de texto neutralizadas contra inyección de fórmulas (=, +, -, @).
        csvCell(b.service?.name),
        csvCell(b.professional?.user?.name),
        csvCell(b.client?.name),
        csvCell(b.client?.email),
        csvCell(b.client?.phone),
        b.status,
        b.service?.price?.toString() || '0',
      ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reservas.csv"');
    res.send('﻿' + header + rows);
  })
);

// Edita / reprograma una reserva (fecha, hora, servicio, profesional, notas).
// Valida pertenencia al negocio y conflictos de agenda igual que el alta (servicio
// `updateBooking`, con el mismo advisory lock). No notifica al cliente: hoy
// services/notifications no tiene una notificación de "reprogramada".
router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'PROFESSIONAL'),
  validate(updateBookingSchema),
  asyncHandler(async (req, res) => {
    const booking = await updateBooking(
      req.auth!.businessId,
      String(req.params.id),
      req.body as UpdateBookingInput
    );
    getIO()?.to(`business:${req.auth!.businessId}`).emit('booking:updated', { booking });
    res.json(booking);
  })
);

// Cambiar el estado (confirmar, cancelar, completar...) es de staff: antes cualquier
// usuario autenticado, incluso un CLIENT, podía cancelar o completar turnos del negocio.
// No hay ningún flujo de cliente que use este endpoint (la web solo lo llama desde el
// panel /reservas), así que se restringe a ADMIN y PROFESSIONAL.
router.patch(
  '/:id/status',
  requireAuth,
  requireRole('ADMIN', 'PROFESSIONAL'),
  validate(updateBookingStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.body as UpdateBookingStatusInput;
    const id = String(req.params.id);
    const businessId = req.auth!.businessId;
    // Una reserva en estado final (cancelada, completada, ausente) NO se reabre: el
    // horario pudo haber sido tomado por otra reserva y quedarían dos turnos
    // superpuestos sin lock ni chequeo. La condición va en el propio UPDATE (atómica);
    // el resto de las transiciones queda como estaba.
    let booking;
    try {
      booking = await prisma.booking.update({
        where: { id, businessId, status: { notIn: FINAL_BOOKING_STATUSES } },
        data: { status },
        include: {
          client: { select: { name: true } },
          service: { select: { name: true } },
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2025') throw err;
      // No hubo fila: o no existe en el negocio (404) o estaba en estado final (409).
      const current = await prisma.booking.findFirst({ where: { id, businessId }, select: { status: true } });
      if (!current) throw new AppError(404, 'Reserva no encontrada');
      throw new AppError(
        409,
        'No se puede cambiar el estado de una reserva cancelada, completada o ausente. Creá una nueva reserva.'
      );
    }
    getIO()?.to(`business:${req.auth!.businessId}`).emit('booking:updated', { booking });

    // Notifica al cliente por su mejor canal (WhatsApp/email) vía la cola de avisos.
    if (status === 'CONFIRMED') {
      void queueNotification({ event: 'booking-confirmed', id: booking.id, businessId: req.auth!.businessId });
    } else if (status === 'CANCELLED') {
      void queueNotification({ event: 'booking-cancelled', id: booking.id, businessId: req.auth!.businessId });
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
