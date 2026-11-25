import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { sharedTryLock } from '../lib/sharedState';

/** TTL del registro "ya votó" (1 año). Con Redis sobrevive a reinicios; sin Redis es memoria del proceso. */
const VOTE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** `github` en la tabla es un booleano ("tiene repo"): aceptamos el flag o una URL de GitHub válida. */
const githubField = z
  .union([z.boolean(), z.string().trim().regex(/^https:\/\/(www\.)?github\.com\/[\w.-]+(\/[\w.-]+)?\/?$/i, 'URL de GitHub inválida')])
  .transform((v) => (typeof v === 'boolean' ? v : true));

/** Rank inicial de una contribución nueva: siempre fuera del podio (1-3); el rank lo define el equipo, no el usuario. */
const PODIUM_SIZE = 3;

const createBuilderSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200).optional(),
  github: githubField.optional(),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(5000).optional(),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const updateBuilderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  github: githubField.optional(),
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
  conversationId: z.string().optional(),
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
    const { name, title, github, description, systemPrompt, model, temperature } = req.body;
    // El rank no lo decide quien sube la contribución: arranca siempre después del
    // podio (antes quedaba en 0 y la UI —rank <= 3— la mostraba en el podio).
    const existing = await prisma.arenaBuilder.count({ where: { businessId: req.auth!.businessId } });
    const builder = await prisma.arenaBuilder.create({
      data: {
        name,
        title: title || name,
        github: github ?? false,
        rank: PODIUM_SIZE + 1 + existing,
        description,
        systemPrompt: systemPrompt || '',
        model: model || 'claude-sonnet-5-5',
        temperature: temperature ?? 0.7,
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
    const { name, title, github, description, systemPrompt, model, temperature, status } = req.body;
    const upd = await prisma.arenaBuilder.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { name, title, github, description, systemPrompt, model, temperature, status },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Builder not found' });
    const builder = await prisma.arenaBuilder.findFirst({ where: { id: req.params.id as string, businessId: req.auth!.businessId } });
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

// Voto a un builder (espejo del voto de ideas). Scopeado por negocio.
router.post(
  '/builders/:id/vote',
  requireAuth,
  asyncHandler(async (req, res) => {
    const target = await prisma.arenaBuilder.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      select: { id: true },
    });
    if (!target) return res.status(404).json({ error: 'Builder not found' });
    // Un voto por usuario y por builder.
    const first = await sharedTryLock(`arena:vote:builder:${req.auth!.businessId}:${target.id}:${req.auth!.userId}`, VOTE_TTL_MS);
    if (!first) return res.status(409).json({ error: 'Ya votaste este builder' });
    const voted = await prisma.arenaBuilder.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { votes: { increment: 1 } },
    });
    if (voted.count === 0) return res.status(404).json({ error: 'Builder not found' });
    const updated = await prisma.arenaBuilder.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    res.json(updated);
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
    const target = await prisma.arenaIdea.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      select: { id: true },
    });
    if (!target) return res.status(404).json({ error: 'Idea not found' });
    // Un voto por usuario y por idea (antes cada request sumaba un voto sin límite).
    const first = await sharedTryLock(`arena:vote:idea:${req.auth!.businessId}:${target.id}:${req.auth!.userId}`, VOTE_TTL_MS);
    if (!first) return res.status(409).json({ error: 'Ya votaste esta idea' });
    const idea = await prisma.arenaIdea.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { votes: { increment: 1 } },
    });
    if (idea.count === 0) return res.status(404).json({ error: 'Idea not found' });
    const updated = await prisma.arenaIdea.findFirst({ where: { id: req.params.id as string, businessId: req.auth!.businessId } });
    res.json(updated);
  })
);

/**
 * POST /api/arena/chat — "Probar bot": responde con el BOT REAL del negocio
 * (mismo motor que /api/ai/chat: processMessage), con el businessId del token,
 * cuota de mensajes del plan y rate limit por negocio. Si viene `builderId`
 * (de este negocio) se suma su systemPrompt al prompt del bot. Devuelve
 * { reply, intent, actions, conversationId }; el front reenvía conversationId
 * para mantener el historial de la charla de prueba.
 */
router.post(
  '/chat',
  requireAuth,
  tenantRateLimit({ name: 'arena-chat', max: 60 }),
  validate(arenaChatSchema),
  asyncHandler(async (req, res) => {
    const { message, builderId, conversationId } = req.body;
    const businessId = req.auth!.businessId;

    let systemPromptExtra: string | undefined;
    if (builderId) {
      const builder = await prisma.arenaBuilder.findFirst({
        where: { id: builderId, businessId },
        select: { systemPrompt: true },
      });
      if (!builder) return res.status(404).json({ error: 'Builder not found' });
      systemPromptExtra = builder.systemPrompt || undefined;
    }

    const result = await processMessage(businessId, message, 'WEB', {
      conversationId,
      contactName: 'Prueba Arena',
      systemPromptExtra,
    });
    res.json({
      reply: result.text,
      intent: result.intent,
      actions: result.actions,
      conversationId: result.conversationId,
    });
  })
);

export const arenaRouter = router;
