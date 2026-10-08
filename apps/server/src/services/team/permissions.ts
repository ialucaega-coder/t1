/**
 * Permisos granulares por miembro del equipo.
 *
 * El rol (ADMIN | PROFESSIONAL | VIEWER) define un set de capacidades por
 * defecto. El administrador puede sobrescribir, por miembro, exactamente qué
 * herramientas abre cada quien (lo que la página de Equipo promete en el paso
 * "Tú decides qué ve cada rol").
 *
 * Una "capacidad" es un área de la plataforma (bots, reservas, clientes, ...),
 * no una ruta suelta: así el admin piensa en herramientas, no en URLs. El mapa
 * capacidad → rutas vive en el front (constants/permissions) para filtrar el
 * menú; acá el back es la fuente de verdad del catálogo y los defaults.
 *
 * Persistencia: el schema de Prisma está congelado, así que guardamos los
 * overrides en el modelo `Connection` con type='TEAM_PERMISSIONS' (un registro
 * por negocio), reutilizando el campo `config Json?`. Mismo patrón que la Voz
 * de Marca (type='BRAND') y el Prompt de sistema (type='SYSTEM_PROMPT').
 */
import { prisma } from '../../lib/prisma';

const PERMISSIONS_CONNECTION_TYPE = 'TEAM_PERMISSIONS';
const PERMISSIONS_CONNECTION_NAME = 'Permisos del equipo';

export type TeamRoleEnum = 'ADMIN' | 'PROFESSIONAL' | 'VIEWER';

/** Una capacidad = un área de herramientas que se puede conceder o quitar. */
export interface Capability {
  key: string;
  label: string;
  description: string;
}

/**
 * Catálogo de capacidades. El orden es el que se muestra en la UI. Cada clave
 * se mapea a un grupo de secciones del panel (ver front constants/permissions).
 */
export const PERMISSION_CATALOG: Capability[] = [
  { key: 'bots', label: 'Bots e IA', description: 'Mis bots, Habilidades, Comandos, Prompt e IA' },
  { key: 'conversations', label: 'Conversaciones', description: 'Bandeja de conversaciones y novedades' },
  { key: 'bookings', label: 'Reservas', description: 'Agenda y gestión de turnos' },
  { key: 'catalog', label: 'Catálogo', description: 'Servicios, productos y órdenes' },
  { key: 'sales', label: 'Ventas y caja', description: 'Movimientos, POS/Caja y cobros' },
  { key: 'clients', label: 'Clientes', description: 'Base de clientes y su ficha' },
  { key: 'analytics', label: 'Análisis', description: 'Análisis y estadísticas del negocio' },
  { key: 'marketing', label: 'Marketing', description: 'Campañas, galería y voz de marca' },
  { key: 'channels', label: 'Canales', description: 'Conexiones, plantillas de WhatsApp y asistente de voz' },
  { key: 'tools', label: 'Herramientas extra', description: 'Superpoderes, bots por giro, marketplace y arena' },
  { key: 'team', label: 'Equipo', description: 'Invitar miembros y gestionar permisos' },
  { key: 'agency', label: 'Modo Agencia', description: 'Gestión de negocios cliente (agencia)' },
  { key: 'billing', label: 'Cuenta y facturación', description: 'Configuración, facturación y white-label' },
];

/** Todas las claves válidas, para validar entradas. */
export const CAPABILITY_KEYS: readonly string[] = PERMISSION_CATALOG.map((c) => c.key);

const ALL_CAPABILITIES = [...CAPABILITY_KEYS];

/** Capacidades por defecto según el rol. ADMIN siempre tiene todas. */
export const ROLE_DEFAULTS: Record<TeamRoleEnum, string[]> = {
  ADMIN: ALL_CAPABILITIES,
  PROFESSIONAL: [
    'bots', 'conversations', 'bookings', 'catalog',
    'sales', 'clients', 'analytics', 'marketing', 'channels', 'tools',
  ],
  VIEWER: ['conversations', 'bookings', 'analytics'],
};

/** Normaliza un rol arbitrario al enum; cae a VIEWER ante algo desconocido. */
export function normalizeRole(role: unknown): TeamRoleEnum {
  return role === 'ADMIN' || role === 'PROFESSIONAL' || role === 'VIEWER' ? role : 'VIEWER';
}

/** Deja solo claves conocidas del catálogo, sin duplicados y en orden canónico. */
export function sanitizeCapabilities(caps: unknown): string[] {
  if (!Array.isArray(caps)) return [];
  const set = new Set(caps.filter((c): c is string => typeof c === 'string'));
  return CAPABILITY_KEYS.filter((k) => set.has(k));
}

// --- Correlación con el plan de suscripción ---
//
// El plan del negocio define QUÉ herramientas están disponibles para TODO el
// negocio (independiente del rol). Dentro de lo que el plan habilita, el admin
// asigna por miembro. Capacidad efectiva = (rol u override) ∩ (plan).
//
// El catálogo de capacidades por plan es acumulativo (cada tier incluye al
// anterior). `billing` está en todos los planes para que siempre se pueda ver
// la facturación y mejorar el plan.

export type PlanTier = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export const PLAN_ORDER: PlanTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

export const PLAN_LABELS: Record<PlanTier, string> = {
  FREE: 'Gratis',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

const FREE_CAPS: string[] = ['bots', 'conversations', 'bookings', 'clients', 'billing'];
const STARTER_CAPS: string[] = [...FREE_CAPS, 'catalog', 'sales', 'analytics', 'channels', 'team'];
const PRO_CAPS: string[] = [...STARTER_CAPS, 'marketing', 'tools'];
const ENTERPRISE_CAPS: string[] = [...PRO_CAPS, 'agency'];

const PLAN_CAPABILITIES_RAW: Record<PlanTier, string[]> = {
  FREE: FREE_CAPS,
  STARTER: STARTER_CAPS,
  PRO: PRO_CAPS,
  ENTERPRISE: ENTERPRISE_CAPS,
};

/** Capacidades del plan en orden canónico del catálogo. */
export const PLAN_CAPABILITIES: Record<PlanTier, string[]> = {
  FREE: CAPABILITY_KEYS.filter((k) => PLAN_CAPABILITIES_RAW.FREE.includes(k)),
  STARTER: CAPABILITY_KEYS.filter((k) => PLAN_CAPABILITIES_RAW.STARTER.includes(k)),
  PRO: CAPABILITY_KEYS.filter((k) => PLAN_CAPABILITIES_RAW.PRO.includes(k)),
  ENTERPRISE: CAPABILITY_KEYS.filter((k) => PLAN_CAPABILITIES_RAW.ENTERPRISE.includes(k)),
};

export function normalizePlanTier(tier: unknown): PlanTier {
  return tier === 'FREE' || tier === 'STARTER' || tier === 'PRO' || tier === 'ENTERPRISE' ? tier : 'FREE';
}

/** Capacidades habilitadas por un tier de plan. */
export function capabilitiesForPlan(tier: PlanTier): string[] {
  return [...PLAN_CAPABILITIES[tier]];
}

/** Tier mínimo que incluye una capacidad (para el cartel "Incluido en Pro"). */
export function minTierForCapability(key: string): PlanTier | null {
  return PLAN_ORDER.find((tier) => PLAN_CAPABILITIES[tier].includes(key)) ?? null;
}

/**
 * Tier del plan vigente del negocio. Lee la suscripción; si no hay o está
 * cancelada/vencida, cae a FREE. Nunca rompe: ante error, FREE.
 */
export async function loadBusinessPlanTier(businessId: string): Promise<PlanTier> {
  try {
    const sub = await prisma.subscription.findUnique({
      where: { businessId },
      include: { plan: { select: { tier: true } } },
    });
    if (!sub || sub.status === 'CANCELLED') return 'FREE';
    return normalizePlanTier(sub.plan?.tier);
  } catch {
    return 'FREE';
  }
}

/** Overrides por miembro guardados en el config. `{ [memberId]: string[] }`. */
export type PermissionOverrides = Record<string, string[]>;

function normalizeOverrides(config: unknown): PermissionOverrides {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config))
    ? (config as Record<string, unknown>)
    : {};
  const raw = (cfg.overrides && typeof cfg.overrides === 'object' && !Array.isArray(cfg.overrides))
    ? (cfg.overrides as Record<string, unknown>)
    : {};
  const out: PermissionOverrides = {};
  for (const [memberId, caps] of Object.entries(raw)) {
    const clean = sanitizeCapabilities(caps);
    if (clean.length > 0) out[memberId] = clean;
  }
  return out;
}

/**
 * Resuelve las capacidades efectivas de un miembro: su override explícito si lo
 * tiene, o el default de su rol. ADMIN siempre obtiene todas (no se puede
 * "encerrar" a un admin fuera de nada).
 */
export function resolveCapabilities(role: unknown, override?: string[]): string[] {
  const r = normalizeRole(role);
  if (r === 'ADMIN') return [...ROLE_DEFAULTS.ADMIN];
  if (override && override.length > 0) return sanitizeCapabilities(override);
  return [...ROLE_DEFAULTS[r]];
}

/** Devuelve el mapa de overrides por miembro del negocio (vacío si no hay). */
export async function loadPermissionOverrides(businessId: string): Promise<PermissionOverrides> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: PERMISSIONS_CONNECTION_TYPE },
  });
  return normalizeOverrides(conn?.config);
}

/**
 * Guarda el override de un miembro. Pasar un array vacío borra el override
 * (el miembro vuelve al default de su rol).
 *
 * Atómico: corre en transacción y bloquea la fila con `SELECT ... FOR UPDATE`
 * antes de re-leer y mergear, para no pisar overrides de otros miembros si dos
 * guardados concurren (lost-update). Mismo patrón que brand/config.ts.
 *
 * Devuelve las capacidades efectivas resultantes para ese miembro, dado su rol.
 */
export async function saveMemberPermissions(
  businessId: string,
  memberId: string,
  caps: string[],
  role: TeamRoleEnum,
): Promise<string[]> {
  const clean = sanitizeCapabilities(caps);

  await prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: PERMISSIONS_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: PERMISSIONS_CONNECTION_NAME,
          type: PERMISSIONS_CONNECTION_TYPE,
          icon: 'Shield',
          isActive: true,
          config: { overrides: {} } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const overrides = normalizeOverrides(fresh?.config);

    if (clean.length === 0) {
      delete overrides[memberId];
    } else {
      overrides[memberId] = clean;
    }

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { overrides } as unknown as object, isActive: true },
    });
  });

  return resolveCapabilities(role, clean);
}
