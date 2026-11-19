import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createScheduleSchema, updateScheduleSchema, CreateScheduleInput, UpdateScheduleInput, isEndAfterStart, END_AFTER_START_MESSAGE } from '../validators/schedules';
import { assertProfessionalInBusiness } from '../services/bookings/create';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { professionalId } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (professionalId) where.professionalId = professionalId;

    const schedules = await prisma.schedule.findMany({
      where,
      include: { professional: { include: { user: { select: { name: true } } } } },
      orderBy: [{ professionalId: 'asc' }, { dayOfWeek: 'asc' }],
    });
    res.json(schedules);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createScheduleSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreateScheduleInput;
    // El profesional tiene que ser de ESTE negocio: antes se aceptaba cualquier id
    // (incluso de otro tenant) y el horario se colgaba de un profesional ajeno.
    await assertProfessionalInBusiness(req.auth!.businessId, data.professionalId);
    const schedule = await prisma.schedule.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(schedule);
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateScheduleSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as UpdateScheduleInput;
    const businessId = req.auth!.businessId;
    const id = String(req.params.id);

    const existing = await prisma.schedule.findFirst({ where: { id, businessId } });
    if (!existing) throw new AppError(404, 'Horario no encontrado');
    // Cambiar solo una de las horas: se compara con la guardada.
    const startTime = data.startTime ?? existing.startTime;
    const endTime = data.endTime ?? existing.endTime;
    if (!isEndAfterStart(startTime, endTime)) throw new AppError(400, END_AFTER_START_MESSAGE);
    // Mover el horario a otro profesional: tiene que ser del negocio.
    if (data.professionalId && data.professionalId !== existing.professionalId) {
      await assertProfessionalInBusiness(businessId, data.professionalId);
    }

    const schedule = await prisma.schedule.update({
      where: { id, businessId },
      data,
    });
    res.json(schedule);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.schedule.delete({ where: { id: String(req.params.id), businessId: req.auth!.businessId } });
    res.status(204).send();
  })
);

export { router as schedulesRouter };
