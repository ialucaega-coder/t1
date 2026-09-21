import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { DEFAULT_SKILLS, DEFAULT_SUPERPOWERS } from '../constants/defaultCatalog';
import { updateCatalogItemSchema, UpdateCatalogItemInput } from '../validators/catalog';
import { generateDailyReport, generateReminders } from '../services/superpowers/report';
import { analyzeConversation, detectKnowledgeGaps } from '../services/superpowers/analysis';
import { ensureDefaultFeatures, readFeatureConfig as readConfig, type FeatureKind } from '../services/catalog';

function mapFeature(row: {
  name: string;
  description: string | null;
  icon: string | null;
  isActive: boolean;
  config: Prisma.JsonValue | null;
}) {
  const config = readConfig(row.config);
  return {
    name: row.name,
    subtitle: config.subtitle ?? '',
    description: row.description ?? '',
    iconName: config.iconName ?? row.icon ?? 'Zap',
    isActive: row.isActive,
  };
}

export function createCatalogFeaturesRouter(kind: FeatureKind) {
  const router = Router();
  const defaults = kind === 'skill' ? DEFAULT_SKILLS : DEFAULT_SUPERPOWERS;
  const missingMessage = kind === 'skill' ? 'Habilidad no encontrada' : 'Superpoder no encontrado';

  // Ganchos de superpoderes que producen contenido leyendo la DB. Solo se
  // montan en el router de superpoderes (no en el de habilidades).
  if (kind === 'superpower') {
    // GET /api/superpowers/report — Superpoder "Reportes automaticos".
    router.get(
      '/report',
      requireAuth,
      asyncHandler(async (req, res) => {
        const report = await generateDailyReport(req.auth!.businessId);
        res.json(report);
      })
    );

    // GET /api/superpowers/reminders — Superpoder "Recordatorios inteligentes".
    router.get(
      '/reminders',
      requireAuth,
      asyncHandler(async (req, res) => {
        const reminders = await generateReminders(req.auth!.businessId);
        res.json(reminders);
      })
    );

    // GET /api/superpowers/analisis/:conversationId — Superpoder "Analista IA".
    // Devuelve { intencion, satisfaccion, objeciones, siguientePaso, resumen }.
    router.get(
      '/analisis/:conversationId',
      requireAuth,
      asyncHandler(async (req, res) => {
        const businessId = req.auth!.businessId;
        const conversationId = decodeURIComponent(String(req.params.conversationId));

        const conversation = await prisma.conversation.findFirst({
          where: { id: conversationId, businessId },
          select: { id: true },
        });
        if (!conversation) throw new AppError(404, 'Conversación no encontrada');

        const messages = await prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: { role: true, text: true },
        });
        if (messages.length === 0) throw new AppError(400, 'La conversación no tiene mensajes para analizar');

        try {
          const analysis = await analyzeConversation(businessId, messages);
          res.json(analysis);
        } catch (err) {
          throw new AppError(503, 'No se pudo analizar la conversación: el proveedor de IA no está disponible');
        }
      })
    );

    // GET /api/superpowers/gaps — Superpoder "Auto-mejora".
    // Detecta huecos de conocimiento (handoffs / respuestas sin datos) y sugiere
    // qué agregar al Prompt/FAQ, agrupado por tema.
    router.get(
      '/gaps',
      requireAuth,
      asyncHandler(async (req, res) => {
        const result = await detectKnowledgeGaps(req.auth!.businessId);
        res.json(result);
      })
    );
  }

  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const businessId = req.auth!.businessId;
      await ensureDefaultFeatures(businessId, kind, defaults);

      const rows = await prisma.skill.findMany({
        where: { businessId },
        orderBy: { name: 'asc' },
      });

      res.json(rows.filter((row) => readConfig(row.config).kind === kind).map(mapFeature));
    })
  );

  router.put(
    '/:name',
    requireAuth,
    requireRole('ADMIN'),
    validate(updateCatalogItemSchema),
    asyncHandler(async (req, res) => {
      const data = req.body as UpdateCatalogItemInput;
      const name = decodeURIComponent(String(req.params.name));
      const businessId = req.auth!.businessId;
      await ensureDefaultFeatures(businessId, kind, defaults);

      const existing = await prisma.skill.findFirst({ where: { businessId, name } });
      if (!existing || readConfig(existing.config).kind !== kind) throw new AppError(404, missingMessage);

      const currentConfig = readConfig(existing.config);
      const updated = await prisma.skill.update({
        where: { id: existing.id },
        data: {
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.iconName !== undefined ? { icon: data.iconName } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          config: {
            kind,
            subtitle: data.subtitle ?? currentConfig.subtitle ?? '',
            iconName: data.iconName ?? currentConfig.iconName ?? existing.icon ?? 'Zap',
          },
        },
      });

      res.json(mapFeature(updated));
    })
  );

  return router;
}
