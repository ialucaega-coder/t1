/**
 * Rutas del Super Admin (panel del DUEÑO de la plataforma). Son cross-tenant:
 * operan sobre TODOS los negocios, no sobre el del token. El aislamiento por
 * negocio que tienen el resto de las rutas acá NO aplica a propósito.
 *
 * Todas van detrás de `requireAuth` + `requirePlatformAdmin` (ver index.ts),
 * así que acá dentro ya damos por hecho que quien llama es un Super Admin.
 *
 * Importante: NO tocamos el schema de Prisma (está congelado). Los feature-flags
 * por negocio se guardan en el modelo `Connection` existente, con
 * type='PLATFORM_FEATURE_FLAGS' y el campo `config Json` (mismo patrón que
 * TEAM_PERMISSIONS / SESSION_REVOCATION).
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

// ─── Feature flags de plataforma (persistidos en Connection) ────────────────

const FEATURE_FLAGS_TYPE = 'PLATFORM_FEATURE_FLAGS';
const FEATURE_FLAGS_NAME = 'Feature flags de plataforma';

export interface PlatformFeatureFlag {
  key: string;
  label: string;
  description: string;
}

/**
 * Catálogo de flags que el dueño puede activar por negocio, por encima de lo que
 * concede el plan. El orden es el que se muestra en la UI. Solo se guardan claves
 * de este catálogo (lo que no esté acá se descarta al guardar).
 */
export const FEATURE_FLAG_CATALOG: PlatformFeatureFlag[] = [
  { key: 'betaFeatures', label: 'Features beta', description: 'Acceso anticipado a funciones en beta.' },
  { key: 'whiteLabelForced', label: 'White-label forzado', description: 'Habilita white-label sin importar el plan.' },
  { key: 'prioritySupport', label: 'Soporte prioritario', description: 'Marca al negocio para atención prioritaria.' },
  { key: 'higherRateLimits', label: 'Límites ampliados', description: 'Rate limits de API más altos para el negocio.' },
  { key: 'allAiEngines', label: 'Todos los motores de IA', description: 'Habilita el catálogo completo de motores de IA.' },
];

const FEATURE_FLAG_KEYS: readonly string[] = FEATURE_FLAG_CATALOG.map((f) => f.key);

/** Deja solo flags conocidos del catálogo, como booleanos, en orden canónico. */
function sanitizeFlags(flags: unknown): Record<string, boolean> {
  const input =
    flags && typeof flags === 'object' && !Array.isArray(flags)
      ? (flags as Record<string, unknown>)
      : {};
  const out: Record<string, boolean> = {};
  for (const key of FEATURE_FLAG_KEYS) {
    if (typeof input[key] === 'boolean') out[key] = input[key] as boolean;
  }
  return out;
}

function normalizeFlags(config: unknown): Record<string, boolean> {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return sanitizeFlags(cfg.flags);
}

// ─── Validación ─────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

const activeSchema = z.object({
  isActive: z.boolean(),
});

const planSchema = z.object({
  tier: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']),
});

const featuresSchema = z.object({
  flags: z.record(z.boolean()),
});

const router = Router();

// ─── GET /api/platform/businesses — lista cross-tenant, paginada ─────────────
router.get(
  '/businesses',
  asyncHandler(async (req, res) => {
    const { page, pageSize, search } = listQuerySchema.parse(req.query);
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [total, businesses] = await Promise.all([
      prisma.business.count({ where }),
      prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              cancelAtPeriodEnd: true,
              currentPeriodEnd: true,
              plan: { select: { tier: true, name: true } },
            },
          },
          _count: { select: { users: true, bots: true } },
        },
      }),
    ]);

    res.json({
      businesses: businesses.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        isActive: b.isActive,
        createdAt: b.createdAt,
        planTier: b.subscription?.plan?.tier ?? null,
        planName: b.subscription?.plan?.name ?? null,
        subscriptionStatus: b.subscription?.status ?? null,
        cancelAtPeriodEnd: b.subscription?.cancelAtPeriodEnd ?? false,
        currentPeriodEnd: b.subscription?.currentPeriodEnd ?? null,
        usersCount: b._count.users,
        botsCount: b._count.bots,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

// ─── PATCH /api/platform/businesses/:id/active — suspender / reactivar ───────
router.patch(
  '/businesses/:id/active',
  validate(activeSchema),
  asyncHandler(async (req, res) => {
    const { isActive } = req.body as { isActive: boolean };
    const updated = await prisma.business.update({
      where: { id: req.params.id as string },
      data: { isActive },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    res.json(updated);
  }),
);

// ─── PATCH /api/platform/businesses/:id/plan — cambiar plan SIN Stripe ───────
// Endpoint "owner": fija el plan del negocio sin pasar por la pasarela de pago.
// Busca el Plan por tier y hace upsert de la Subscription (ACTIVE, sin cancelar).
router.patch(
  '/businesses/:id/plan',
  validate(planSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.params.id as string;
    const { tier } = req.body as { tier: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE' };

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!business) {
      res.status(404).json({ error: 'Negocio no encontrado' });
      return;
    }

    const plan = await prisma.plan.findUnique({ where: { tier } });
    if (!plan) {
      res.status(404).json({ error: `No existe un plan con tier ${tier}` });
      return;
    }

    const now = new Date();
    // Período largo: el cambio lo hace el dueño, no vence por facturación.
    const periodEnd = new Date(now);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    const subscription = await prisma.subscription.upsert({
      where: { businessId },
      update: {
        planId: plan.id,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      },
      create: {
        businessId,
        planId: plan.id,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      include: { plan: { select: { tier: true, name: true } } },
    });

    res.json({
      businessId,
      planTier: subscription.plan.tier,
      planName: subscription.plan.name,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    });
  }),
);

// ─── GET /api/platform/businesses/:id/features — feature flags del negocio ───
router.get(
  '/businesses/:id/features',
  asyncHandler(async (req, res) => {
    const businessId = req.params.id as string;
    const conn = await prisma.connection.findFirst({
      where: { businessId, type: FEATURE_FLAGS_TYPE },
      select: { config: true },
    });
    res.json({
      catalog: FEATURE_FLAG_CATALOG,
      flags: normalizeFlags(conn?.config),
    });
  }),
);

// ─── PUT /api/platform/businesses/:id/features — guardar feature flags ───────
router.put(
  '/businesses/:id/features',
  validate(featuresSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.params.id as string;
    const flags = sanitizeFlags((req.body as { flags: Record<string, boolean> }).flags);

    // Lock de fila (SELECT ... FOR UPDATE) para no pisar un guardado concurrente,
    // mismo patrón que services/team/permissions.ts y services/auth/revocation.ts.
    await prisma.$transaction(async (tx) => {
      let conn = await tx.connection.findFirst({
        where: { businessId, type: FEATURE_FLAGS_TYPE },
        select: { id: true },
      });

      if (!conn) {
        conn = await tx.connection.create({
          data: {
            name: FEATURE_FLAGS_NAME,
            type: FEATURE_FLAGS_TYPE,
            icon: 'ToggleRight',
            isActive: true,
            config: { flags } as unknown as object,
            businessId,
          },
          select: { id: true },
        });
      } else {
        await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
        await tx.connection.update({
          where: { id: conn.id },
          data: { config: { flags } as unknown as object, isActive: true },
        });
      }
    });

    res.json({ businessId, flags });
  }),
);

export const platformRouter = router;
