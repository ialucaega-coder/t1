import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, STAFF_ROLES } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { bookingDateKey, minutesToTime, overlaps, timeToMinutes } from '../services/bookings/time';

const SLOT_STEP_MIN = 30;

const createProfessionalSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  bio: z.string().max(500).optional(),
  specialties: z.array(z.string().max(60)).max(20).optional(),
  serviceIds: z.array(z.string().min(1).max(64)).max(100).optional(),
});

const updateProfessionalSchema = z.object({
  bio: z.string().max(500).optional(),
  specialties: z.array(z.string().max(60)).max(20).optional(),
  isAvailable: z.boolean().optional(),
  serviceIds: z.array(z.string().min(1).max(64)).max(100).optional(),
});

const router = Router();

/** ¿El rol es de staff (ADMIN / PROFESSIONAL)? El resto (CLIENT) solo ve datos públicos. */
const isStaff = (role: string | undefined) => STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number]);

/**
 * Los servicios que se conectan a un profesional tienen que ser del negocio (y no
 * estar dados de baja): antes `connect`/`set` aceptaban cualquier id, incluso de
 * otro tenant. Lanza 404 si falta alguno.
 */
async function assertServicesInBusiness(businessId: string, serviceIds: string[]): Promise<void> {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return;
  const found = await prisma.service.count({ where: { id: { in: ids }, businessId, deletedAt: null } });
  if (found !== ids.length) throw new AppError(404, 'Alguno de los servicios no existe en este negocio');
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const staff = isStaff(req.auth!.role);
    const professionals = await prisma.professional.findMany({
      where: { businessId: req.auth!.businessId },
      include: {
        // Email y teléfono de los profesionales son solo para staff.
        user: { select: staff ? { id: true, name: true, email: true, phone: true, avatar: true } : { id: true, name: true, avatar: true } },
        schedules: true,
        ...(staff ? { _count: { select: { bookings: true } } } : {}),
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
    // Staff: ficha completa con las últimas reservas. CLIENT: solo datos públicos
    // (sin reservas —notas, importes, clientes— ni email/teléfono).
    const staff = isStaff(req.auth!.role);
    const professional = await prisma.professional.findUnique({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      include: staff
        ? {
            user: { select: { name: true, email: true, phone: true } },
            schedules: true,
            services: true,
            bookings: { take: 10, orderBy: { date: 'desc' }, include: { service: true, client: { select: { name: true } } } },
          }
        : {
            user: { select: { name: true } },
            schedules: true,
            services: true,
          },
    });
    if (!professional) {
      throw new AppError(404, 'Professional not found');
    }
    res.json(professional);
  })
);

/**
 * GET /:id/availability?date=YYYY-MM-DD[&serviceId=...]
 * Franjas de 30 min libres del profesional ese día. Con `serviceId` solo ofrece las
 * franjas donde ENTRA el servicio completo (duración) sin pisar otro turno ni pasarse
 * del horario de atención. Cuenta como ocupado todo turno no cancelado (igual que el
 * alta de reservas: NO_SHOW y COMPLETED también ocupan el horario).
 */
router.get(
  '/:id/availability',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { date, serviceId } = req.query;
    if (!date) {
      throw new AppError(400, 'Date is required');
    }

    const businessId = req.auth!.businessId;
    const professionalId = String(req.params.id);
    // Fecha normalizada (YYYY-MM-DD, UTC): el día de la semana ya no depende de la
    // zona horaria del servidor y la consulta matchea aunque llegue un ISO con hora.
    const dateKey = bookingDateKey(String(date));
    const targetDate = new Date(dateKey);
    const utcDay = targetDate.getUTCDay();
    const dayOfWeek = utcDay === 0 ? 7 : utcDay;

    let serviceDuration: number | null = null;
    if (serviceId) {
      const service = await prisma.service.findFirst({
        // Un servicio dado de baja (deletedAt) no se ofrece: 404 como si no existiera.
        where: { id: String(serviceId), businessId, deletedAt: null },
        select: { duration: true },
      });
      if (!service) throw new AppError(404, 'Service not found');
      serviceDuration = service.duration;
    }

    const schedule = await prisma.schedule.findFirst({
      where: { professionalId, businessId, dayOfWeek, isActive: true },
    });

    if (!schedule) {
      res.json({ available: false, slots: [] });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: {
        businessId,
        professionalId,
        date: targetDate,
        status: { notIn: ['CANCELLED'] },
      },
      select: { startTime: true, endTime: true },
    });

    const scheduleStart = timeToMinutes(schedule.startTime);
    const scheduleEnd = timeToMinutes(schedule.endTime);
    const slotLength = serviceDuration ?? SLOT_STEP_MIN;
    const slots: string[] = [];

    for (let m = scheduleStart; m < scheduleEnd; m += SLOT_STEP_MIN) {
      // Con servicio, el turno completo tiene que entrar en el horario de atención.
      if (serviceDuration !== null && m + slotLength > scheduleEnd) continue;
      const slot = { startTime: minutesToTime(m), endTime: minutesToTime(m + slotLength) };
      if (!bookings.some((b) => overlaps(slot, b))) slots.push(slot.startTime);
    }

    res.json({ available: true, schedule, slots });
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createProfessionalSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, bio, specialties, serviceIds } = req.body;

    const businessId = req.auth!.businessId;
    if (serviceIds?.length) await assertServicesInBusiness(businessId, serviceIds);

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
  requireRole('ADMIN'),
  validate(updateProfessionalSchema),
  asyncHandler(async (req, res) => {
    const { bio, specialties, isAvailable, serviceIds } = req.body;
    const businessId = req.auth!.businessId;

    const id = String(req.params.id);
    const existing = await prisma.professional.findUnique({
      where: { id, businessId },
    });
    if (!existing) throw new AppError(404, 'Professional not found');
    if (serviceIds?.length) await assertServicesInBusiness(businessId, serviceIds);

    const updateData: Prisma.ProfessionalUpdateInput = {};
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
  requireRole('ADMIN'),
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
