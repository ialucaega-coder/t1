import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
const router = Router();

const createBookingSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  serviceId: z.string(),
  professionalId: z.string(),
  clientId: z.string().optional(),
  notes: z.string().optional(),
  source: z.enum(['WEB', 'TELEGRAM', 'WHATSAPP', 'VOICE', 'WALK_IN']).default('WEB'),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { date, status, professionalId } = req.query;
    const where: Record<string, unknown> = { businessId: req.auth!.businessId };
    if (date) where.date = new Date(date as string);
    if (status) where.status = status;
    if (professionalId) where.professionalId = professionalId;

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
        professional: { include: { user: { select: { name: true } } } },
        service: { select: { id: true, name: true, duration: true, price: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    res.json(bookings);
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const data = createBookingSchema.parse(req.body);
    const service = await prisma.service.findUnique({ where: { id: data.serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
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

    res.status(201).json(booking);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await prisma.booking.update({
      where: { id: req.params.id, businessId: req.auth!.businessId },
      data: { status },
    });
    res.json(booking);
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.booking.delete({
      where: { id: req.params.id, businessId: req.auth!.businessId },
    });
    res.status(204).send();
  } catch (error) {
    console.error('Delete booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as bookingsRouter };
