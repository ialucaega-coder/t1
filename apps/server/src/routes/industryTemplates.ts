import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { INDUSTRY_TEMPLATES, getIndustryTemplate } from '../constants/industryTemplates';
import { DEFAULT_SUPERPOWERS } from '../constants/defaultCatalog';

const router = Router();

const PROMPT_TYPE = 'prompt';
const SUPERPOWER_KIND = 'superpower';

// --- Helpers de prompt (formato compatible con routes/prompts.ts) ---
function writePromptCategory(category: string, isActive: boolean) {
  return `${category.trim() || 'General'} [${isActive ? 'active' : 'inactive'}]`;
}

// --- Helpers de superpoderes (formato compatible con routes/catalogFeatures.ts) ---
function readConfig(config: Prisma.JsonValue | null) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as { kind?: string; subtitle?: string; iconName?: string };
}

async function ensureDefaultSuperpowers(businessId: string) {
  const existing = await prisma.skill.findMany({ where: { businessId } });
  const existingForKind = existing.filter((row) => readConfig(row.config).kind === SUPERPOWER_KIND);
  if (existingForKind.length > 0) return;

  await prisma.skill.createMany({
    data: DEFAULT_SUPERPOWERS.map((feature) => ({
      businessId,
      name: feature.name,
      description: feature.description,
      icon: feature.iconName,
      isActive: feature.isActive,
      config: { kind: SUPERPOWER_KIND, subtitle: feature.subtitle, iconName: feature.iconName },
    })),
  });
}

// GET /api/plantillas-negocio -> lista las 14 plantillas por giro
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(INDUSTRY_TEMPLATES);
  })
);

// POST /api/plantillas-negocio/:id/aplicar -> aplica la plantilla al negocio
router.post(
  '/:id/aplicar',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const template = getIndustryTemplate(String(req.params.id));
    if (!template) throw new AppError(404, 'Plantilla no encontrada');

    // 1) Servicios: crear solo los que no existan (idempotente por nombre)
    const existingServices = await prisma.service.findMany({
      where: { businessId },
      select: { name: true, sortOrder: true },
    });
    const existingNames = new Set(existingServices.map((s) => s.name.trim().toLowerCase()));
    let nextSortOrder = existingServices.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;

    const serviciosACrear = template.servicios.filter(
      (s) => !existingNames.has(s.name.trim().toLowerCase())
    );

    if (serviciosACrear.length > 0) {
      await prisma.service.createMany({
        data: serviciosACrear.map((s) => ({
          businessId,
          name: s.name,
          description: s.description,
          duration: s.durationMin,
          price: new Prisma.Decimal(s.price),
          isActive: true,
          sortOrder: nextSortOrder++,
        })),
      });
    }

    // 2) Prompt sugerido: crear o actualizar (idempotente por nombre)
    const promptName = `Personalidad del bot - ${template.nombre}`;
    const existingPrompt = await prisma.template.findFirst({
      where: { businessId, type: PROMPT_TYPE, name: promptName },
    });
    if (existingPrompt) {
      await prisma.template.update({
        where: { id: existingPrompt.id },
        data: { content: template.prompt, category: writePromptCategory('Personalidad', true) },
      });
    } else {
      await prisma.template.create({
        data: {
          businessId,
          name: promptName,
          type: PROMPT_TYPE,
          content: template.prompt,
          category: writePromptCategory('Personalidad', true),
        },
      });
    }

    // 3) Superpoderes recomendados: asegurar defaults y activarlos
    await ensureDefaultSuperpowers(businessId);
    const skills = await prisma.skill.findMany({ where: { businessId } });
    const superpowerByName = new Map(
      skills
        .filter((row) => readConfig(row.config).kind === SUPERPOWER_KIND)
        .map((row) => [row.name.trim().toLowerCase(), row])
    );

    const superpoderesActivados: string[] = [];
    for (const nombre of template.superpoderes) {
      const skill = superpowerByName.get(nombre.trim().toLowerCase());
      if (!skill) continue;
      if (!skill.isActive) {
        await prisma.skill.update({ where: { id: skill.id }, data: { isActive: true } });
      }
      superpoderesActivados.push(skill.name);
    }

    res.json({
      success: true,
      plantilla: { id: template.id, nombre: template.nombre },
      serviciosCreados: serviciosACrear.length,
      serviciosOmitidos: template.servicios.length - serviciosACrear.length,
      promptAplicado: promptName,
      superpoderesActivados,
    });
  })
);

export { router as industryTemplatesRouter };
