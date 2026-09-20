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
): { kind?: string; subtitle?: string; iconName?: string } {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as { kind?: string; subtitle?: string; iconName?: string };
}

/**
 * Siembra los defaults de un tipo (skill/superpower) para un negocio si todavía
 * no tiene ninguno. Es idempotente en el caso normal; ante dos llamadas casi
 * simultáneas en el primerísimo uso podría sembrar dos veces (no hay @@unique en
 * Skill), pero al centralizarla queda un único lugar para endurecerla a futuro.
 */
export async function ensureDefaultFeatures(
  businessId: string,
  kind: FeatureKind,
  defaults: readonly DefaultFeature[]
): Promise<void> {
  const existing = await prisma.skill.findMany({ where: { businessId } });
  const existingForKind = existing.filter((row) => readFeatureConfig(row.config).kind === kind);
  if (existingForKind.length > 0) return;

  await prisma.skill.createMany({
    data: defaults.map((feature) => ({
      businessId,
      name: feature.name,
      description: feature.description,
      icon: feature.iconName,
      isActive: feature.isActive,
      config: { kind, subtitle: feature.subtitle, iconName: feature.iconName },
    })),
  });
}
