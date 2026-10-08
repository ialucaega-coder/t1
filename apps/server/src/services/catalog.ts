/**
 * Helpers compartidos del catálogo de features (skills y superpoderes).
 *
 * Antes esta lógica estaba duplicada en routes/catalogFeatures.ts y
 * routes/industryTemplates.ts. Se centraliza acá para evitar divergencias
 * y un segundo lugar donde el "sembrado de defaults" pudiera fallar.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type FeatureKind = 'skill' | 'superpower';

export interface DefaultFeature {
  name: string;
  subtitle: string;
  description: string;
  iconName: string;
  isActive: boolean;
}

/** Lee de forma segura el config (Json) de un Skill. */
export function readFeatureConfig(
  config: Prisma.JsonValue | null
): { kind?: string; subtitle?: string; iconName?: string; params?: Record<string, unknown> } {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as { kind?: string; subtitle?: string; iconName?: string; params?: Record<string, unknown> };
}

/** Nombres (normalizados) de las features de un `kind` ya presentes en un negocio. */
function existingNamesForKind(
  rows: { name: string; config: Prisma.JsonValue | null }[],
  kind: FeatureKind
): Set<string> {
  return new Set(
    rows
      .filter((row) => readFeatureConfig(row.config).kind === kind)
      .map((row) => row.name.trim().toLowerCase())
  );
}

/** Payload de `createMany` para las features faltantes. */
function toSkillRows(businessId: string, kind: FeatureKind, features: DefaultFeature[]) {
  return features.map((feature) => ({
    businessId,
    name: feature.name,
    description: feature.description,
    icon: feature.iconName,
    isActive: feature.isActive,
    config: { kind, subtitle: feature.subtitle, iconName: feature.iconName },
  }));
}

/**
 * Siembra los defaults de un tipo (skill/superpower) para un negocio, agregando
 * solo los que falten. Así, cuando se suman features nuevas al catálogo, también
 * aparecen en los negocios que ya tenían las anteriores.
 *
 * Race-safe: como Skill no tiene @@unique (freeze de schema), dos requests casi
 * simultáneas del primer uso podrían sembrar duplicados. Fast path sin lock; si
 * hay faltantes, tomamos un advisory lock transaccional por negocio+kind y
 * re-chequeamos adentro, igual que en el sembrado de comandos y marketplace.
 */
export async function ensureDefaultFeatures(
  businessId: string,
  kind: FeatureKind,
  defaults: readonly DefaultFeature[]
): Promise<void> {
  // Fast path sin lock: calculamos faltantes con lo que ya hay.
  const existing = await prisma.skill.findMany({ where: { businessId } });
  const existingNames = existingNamesForKind(existing, kind);
  const missing = defaults.filter((f) => !existingNames.has(f.name.trim().toLowerCase()));
  if (missing.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seed-features:${kind}:${businessId}`}, 0))`;

    // Re-chequeo con el lock tomado: otra request concurrente pudo sembrar ya.
    const inside = await tx.skill.findMany({ where: { businessId } });
    const insideNames = existingNamesForKind(inside, kind);
    const stillMissing = defaults.filter((f) => !insideNames.has(f.name.trim().toLowerCase()));
    if (stillMissing.length === 0) return;

    await tx.skill.createMany({ data: toSkillRows(businessId, kind, stillMissing) });
  });
}
