import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { DEFAULT_SKILLS, DEFAULT_SUPERPOWERS } from '../constants/defaultCatalog';
import { updateCatalogItemSchema, UpdateCatalogItemInput } from '../validators/catalog';
import { generateDailyReport, generateReminders } from '../services/superpowers/report';

type FeatureKind = 'skill' | 'superpower';

interface DefaultFeature {
  name: string;
  subtitle: string;
  description: string;
  iconName: string;
  isActive: boolean;
}

function configFor(kind: FeatureKind, feature: Omit<DefaultFeature, 'name' | 'isActive'>) {
  return {
    kind,
    subtitle: feature.subtitle,
    iconName: feature.iconName,
  };
}

function readConfig(config: Prisma.JsonValue | null) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as { kind?: string; subtitle?: string; iconName?: string };
}

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

async function ensureDefaultFeatures(businessId: string, kind: FeatureKind, defaults: readonly DefaultFeature[]) {
  const existing = await prisma.skill.findMany({ where: { businessId } });
  const existingForKind = existing.filter((row) => readConfig(row.config).kind === kind);
  if (existingForKind.length > 0) return;

  await prisma.skill.createMany({
    data: defaults.map((feature) => ({
      businessId,
      name: feature.name,
      description: feature.description,
      icon: feature.iconName,
      isActive: feature.isActive,
      config: configFor(kind, feature),
    })),
  });
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
