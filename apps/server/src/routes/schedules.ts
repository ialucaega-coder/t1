import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

const scheduleSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  professionalId: z.string(),
  isActive: z.boolean().default(true),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { professionalId } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (professionalId) where.professionalId = professionalId;

    const schedules = await prisma.schedule.findMany({
      where,
      include: { professional: { include: { user: { select: { name: true } } } } },
      orderBy: [{ professionalId: 'asc' }, { dayOfWeek: 'asc' }],
    });
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const data = scheduleSchema.parse(req.body);
    const schedule = await prisma.schedule.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(schedule);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const data = scheduleSchema.partial().parse(req.body);
    const schedule = await prisma.schedule.update({
      where: { id: req.params.id },
      data,
    });
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.schedule.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as schedulesRouter };
