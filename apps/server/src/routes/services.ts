import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
const router = Router();

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  duration: z.number().int().positive(),
  price: z.number().positive(),
  categoryId: z.string().optional(),
  isActive: z.boolean().default(true),
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { businessId: req.auth!.businessId },
      include: { category: true, professionals: { include: { user: { select: { name: true } } } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(services);
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const data = serviceSchema.parse(req.body);
    const service = await prisma.service.create({
      data: { ...data, businessId: req.auth!.businessId },
    });
    res.status(201).json(service);
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
    const data = serviceSchema.partial().parse(req.body);
    const service = await prisma.service.update({
      where: { id: req.params.id, businessId: req.auth!.businessId },
      data,
    });
    res.json(service);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as servicesRouter };
