import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createScheduleSchema, updateScheduleSchema, CreateScheduleInput, UpdateScheduleInput } from '../validators/schedules';

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
    const schedule = await prisma.schedule.update({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
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
