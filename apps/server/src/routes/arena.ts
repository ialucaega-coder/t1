import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const createBuilderSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(5000).optional(),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const updateBuilderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(5000).optional(),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
});

const createIdeaSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
});

const arenaChatSchema = z.object({
  message: z.string().min(1).max(2000),
  builderId: z.string().optional(),
});

const router = Router();

router.get(
  '/builders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const builders = await prisma.arenaBuilder.findMany({
      where: { businessId: req.auth!.businessId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(builders);
  })
);

router.post(
  '/builders',
  requireAuth,
  requireRole('ADMIN'),
  validate(createBuilderSchema),
  asyncHandler(async (req, res) => {
    const { name, description, systemPrompt, model, temperature } = req.body;
    const builder = await prisma.arenaBuilder.create({
      data: {
        name,
        description,
        systemPrompt: systemPrompt || '',
        model: model || 'claude-sonnet-5',
        temperature: temperature || 0.7,
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(builder);
  })
);

router.patch(
  '/builders/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateBuilderSchema),
  asyncHandler(async (req, res) => {
    const { name, description, systemPrompt, model, temperature, status } = req.body;
    const upd = await prisma.arenaBuilder.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { name, description, systemPrompt, model, temperature, status },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Builder not found' });
    const builder = await prisma.arenaBuilder.findUnique({ where: { id: req.params.id as string } });
    res.json(builder);
  })
);

router.delete(
  '/builders/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.arenaBuilder.deleteMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Builder not found' });
    res.status(204).send();
  })
);

router.get(
  '/ideas',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ideas = await prisma.arenaIdea.findMany({
      where: { businessId: req.auth!.businessId },
      orderBy: { votes: 'desc' },
    });
    res.json(ideas);
  })
);

router.post(
  '/ideas',
  requireAuth,
  validate(createIdeaSchema),
  asyncHandler(async (req, res) => {
    const { title, description, category } = req.body;
    const idea = await prisma.arenaIdea.create({
      data: {
        title,
        description,
        category: category || 'general',
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(idea);
  })
);

router.post(
  '/ideas/:id/vote',
  requireAuth,
  asyncHandler(async (req, res) => {
    const idea = await prisma.arenaIdea.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { votes: { increment: 1 } },
    });
    if (idea.count === 0) return res.status(404).json({ error: 'Idea not found' });
    const updated = await prisma.arenaIdea.findUnique({ where: { id: req.params.id as string } });
    res.json(updated);
  })
);

router.post(
  '/chat',
  requireAuth,
  validate(arenaChatSchema),
  asyncHandler(async (req, res) => {
    const { message, builderId } = req.body;
    res.json({
      response: `Respuesta de prueba del bot Arena. Tu mensaje: "${message}". Builder: ${builderId || 'default'}`,
      tokens: { input: message.length * 2, output: 50 },
    });
  })
);

export const arenaRouter = router;
