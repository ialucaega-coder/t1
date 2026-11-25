import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole, requireStaff } from '../middleware/auth';
import { requireCapability } from '../middleware/capability';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { DEFAULT_SKILLS, DEFAULT_SUPERPOWERS } from '../constants/defaultCatalog';
import { updateCatalogItemSchema, UpdateCatalogItemInput } from '../validators/catalog';
import { generateDailyReport, generateReminders } from '../services/superpowers/report';
import { analyzeConversation, detectKnowledgeGaps } from '../services/superpowers/analysis';
import { ensureDefaultFeatures, readFeatureConfig as readConfig, type FeatureKind } from '../services/catalog';
import { SUPERPOWER_PARAM_SPECS, resolveSuperpowerParams, sanitizeSuperpowerParams } from '../constants/superpowerParams';

function mapFeature(row: {
  name: string;
  description: string | null;
  icon: string | null;
  isActive: boolean;
  config: Prisma.JsonValue | null;
}) {
  const config = readConfig(row.config);
  const paramSpecs = SUPERPOWER_PARAM_SPECS[row.name] ?? [];
  return {
    name: row.name,
    subtitle: config.subtitle ?? '',
    description: row.description ?? '',
    iconName: config.iconName ?? row.icon ?? 'Zap',
    isActive: row.isActive,
    // Params configurables (resueltos con defaults) + su spec, para que el
    // front renderice los controles. Vacíos si el feature no tiene params.
    params: paramSpecs.length ? resolveSuperpowerParams(row.name, config.params) : {},
    paramSpecs,
  };
}

export function createCatalogFeaturesRouter(kind: FeatureKind) {
  const router = Router();
  const defaults = kind === 'skill' ? DEFAULT_SKILLS : DEFAULT_SUPERPOWERS;
  const missingMessage = kind === 'skill' ? 'Habilidad no encontrada' : 'Superpoder no encontrado';

  // Ganchos de superpoderes que producen contenido leyendo la DB. Solo se
  // montan en el router de superpoderes (no en el de habilidades).
  if (kind === 'superpower') {
    // Estos 4 ganchos leen datos del negocio (turnos con nombres y horarios, KPIs,
    // conversaciones) y gastan cuota de IA: solo staff, y con la capacidad que
    // corresponde (herramientas para reportes/recordatorios, conversaciones para el
    // análisis y los huecos de conocimiento). Un CLIENT/viewer con JWT ya no los llama.
    const staffTools = [requireAuth, requireStaff, requireCapability('tools')];
    const staffConversations = [requireAuth, requireStaff, requireCapability('conversations')];

    // GET /api/superpowers/report — Superpoder "Reportes automaticos".
    router.get(
      '/report',
      ...staffTools,
      asyncHandler(async (req, res) => {
        const report = await generateDailyReport(req.auth!.businessId);
        res.json(report);
      })
    );

    // GET /api/superpowers/reminders — Superpoder "Recordatorios inteligentes".
    router.get(
      '/reminders',
      ...staffTools,
      asyncHandler(async (req, res) => {
        const reminders = await generateReminders(req.auth!.businessId);
        res.json(reminders);
      })
    );

    // GET /api/superpowers/analisis/:conversationId — Superpoder "Analista IA".
    // Devuelve { intencion, satisfaccion, objeciones, siguientePaso, resumen }.
    router.get(
      '/analisis/:conversationId',
      ...staffConversations,
      tenantRateLimit({ name: 'sp-analisis', max: 30 }),
      asyncHandler(async (req, res) => {
        const businessId = req.auth!.businessId;
        // Express ya decodifica los params: decodificar de nuevo daba 500 con un '%' suelto.
        const conversationId = String(req.params.conversationId);

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
      ...staffConversations,
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
      // Express ya decodifica los params (un '%' suelto rompía con 500 al decodificar de nuevo).
      const name = String(req.params.name);
      const businessId = req.auth!.businessId;
      await ensureDefaultFeatures(businessId, kind, defaults);

      const existing = await prisma.skill.findFirst({ where: { businessId, name } });
      if (!existing || readConfig(existing.config).kind !== kind) throw new AppError(404, missingMessage);

      const currentConfig = readConfig(existing.config);

      // Params: si vienen en el parche, los normalizamos contra el spec del
      // superpoder (descarta claves/valores inválidos); si no, conservamos los
      // guardados. Solo aplica a superpoderes con spec; el resto quedan en {}.
      const specs = SUPERPOWER_PARAM_SPECS[name];
      const nextParams = specs
        ? sanitizeSuperpowerParams(name, data.params !== undefined ? data.params : currentConfig.params)
        : undefined;

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
            ...(nextParams ? { params: nextParams } : {}),
          },
        },
      });

      res.json(mapFeature(updated));
    })
  );

  return router;
}
