// Catálogo de permisos granulares del equipo (debe coincidir con el backend:
// apps/server/src/services/team/permissions.ts). Una "capacidad" es un área de
// herramientas que el admin puede conceder o quitar por miembro. Acá además
// mapeamos cada capacidad a las rutas del menú para filtrar la navegación según
// las capacidades del usuario logueado.

export type CapabilityKey =
  | 'bots'
  | 'conversations'
  | 'bookings'
  | 'catalog'
  | 'sales'
  | 'clients'
  | 'analytics'
  | 'marketing'
  | 'channels'
  | 'tools'
  | 'team'
  | 'agency'
  | 'billing';

export type TeamRoleEnum = 'ADMIN' | 'PROFESSIONAL' | 'VIEWER';

export interface Capability {
  key: CapabilityKey;
  label: string;
  description: string;
}

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

export const CAPABILITY_KEYS: CapabilityKey[] = PERMISSION_CATALOG.map((c) => c.key);

const ALL: CapabilityKey[] = [...CAPABILITY_KEYS];

export const ROLE_DEFAULTS: Record<TeamRoleEnum, CapabilityKey[]> = {
  ADMIN: ALL,
  PROFESSIONAL: [
    'bots', 'conversations', 'bookings', 'catalog',
    'sales', 'clients', 'analytics', 'marketing', 'channels', 'tools',
  ],
  VIEWER: ['conversations', 'bookings', 'analytics'],
};

// Mapa capacidad → rutas del menú (apps/web/src/config/navigation.ts). Las
// rutas que NO aparecen acá quedan siempre visibles (no se ocultan por error).
export const CAPABILITY_ROUTES: Record<CapabilityKey, string[]> = {
  bots: ['/dashboard', '/habilidades', '/comandos', '/prompt', '/ia'],
  conversations: ['/conversaciones', '/novedades'],
  bookings: ['/reservas'],
  catalog: ['/servicios', '/productos', '/ordenes'],
  sales: ['/movimientos', '/pos', '/cobros'],
  clients: ['/clientes'],
  analytics: ['/analisis', '/estadisticas'],
  marketing: ['/campanas', '/galeria', '/voz-de-marca'],
  channels: ['/conexiones', '/plantillas', '/asistente-voz'],
  tools: ['/superpoderes', '/plantillas-negocio', '/marketplace', '/arena'],
  team: ['/equipo'],
  agency: ['/agencia'],
  billing: ['/configuracion', '/facturacion', '/whitelabel'],
};

// --- Planes de suscripción ---
// El plan del negocio define qué capacidades están disponibles para TODO el
// negocio; dentro de eso, el admin asigna por usuario. Debe coincidir con el
// backend (apps/server/src/services/team/permissions.ts).

export type PlanTier = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export const PLAN_ORDER: PlanTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

export const PLAN_LABELS: Record<PlanTier, string> = {
  FREE: 'Gratis',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

const FREE_CAPS: CapabilityKey[] = ['bots', 'conversations', 'bookings', 'clients', 'billing'];
const STARTER_CAPS: CapabilityKey[] = [...FREE_CAPS, 'catalog', 'sales', 'analytics', 'channels', 'team'];
const PRO_CAPS: CapabilityKey[] = [...STARTER_CAPS, 'marketing', 'tools'];
const ENTERPRISE_CAPS: CapabilityKey[] = [...PRO_CAPS, 'agency'];

export const PLAN_CAPABILITIES: Record<PlanTier, CapabilityKey[]> = {
  FREE: CAPABILITY_KEYS.filter((k) => FREE_CAPS.includes(k)),
  STARTER: CAPABILITY_KEYS.filter((k) => STARTER_CAPS.includes(k)),
  PRO: CAPABILITY_KEYS.filter((k) => PRO_CAPS.includes(k)),
  ENTERPRISE: CAPABILITY_KEYS.filter((k) => ENTERPRISE_CAPS.includes(k)),
};

export function normalizePlanTier(tier: unknown): PlanTier {
  return tier === 'FREE' || tier === 'STARTER' || tier === 'PRO' || tier === 'ENTERPRISE' ? tier : 'FREE';
}

export function capabilitiesForPlan(tier: PlanTier): CapabilityKey[] {
  return [...PLAN_CAPABILITIES[tier]];
}

/** Tier mínimo que incluye una capacidad (para "Incluido en Pro"). */
export function minTierForCapability(key: string): PlanTier | null {
  return PLAN_ORDER.find((tier) => PLAN_CAPABILITIES[tier].includes(key as CapabilityKey)) ?? null;
}

// Rutas que todo usuario autenticado ve, independientemente de capacidades
// (evita bloquear a alguien fuera de su propio perfil/config básica).
const ALWAYS_VISIBLE = new Set<string>(['/configuracion']);

function normalizeRole(role: unknown): TeamRoleEnum {
  return role === 'ADMIN' || role === 'PROFESSIONAL' || role === 'VIEWER' ? role : 'VIEWER';
}

export function sanitizeCapabilities(caps: unknown): CapabilityKey[] {
  if (!Array.isArray(caps)) return [];
  const set = new Set(caps.filter((c): c is string => typeof c === 'string'));
  return CAPABILITY_KEYS.filter((k) => set.has(k));
}

// Capacidades efectivas: ADMIN siempre todas; si hay override lo usa; si no, el
// default del rol.
export function resolveCapabilities(role: unknown, override?: string[]): CapabilityKey[] {
  const r = normalizeRole(role);
  if (r === 'ADMIN') return [...ROLE_DEFAULTS.ADMIN];
  if (override && override.length > 0) return sanitizeCapabilities(override);
  return [...ROLE_DEFAULTS[r]];
}

// Capacidad efectiva: lo que el rol/override concede ∩ lo que el plan habilita.
export function effectiveCapabilities(
  role: unknown,
  override: string[] | undefined,
  planCaps: CapabilityKey[] | null,
): CapabilityKey[] {
  const base = resolveCapabilities(role, override);
  if (!planCaps) return base;
  const inPlan = new Set(planCaps);
  return base.filter((k) => inPlan.has(k));
}

// Capacidad "dueña" de una ruta. Matchea por prefijo para cubrir subrutas
// (ej: /conversaciones/123 → conversations). Devuelve null si ninguna la reclama.
export function ownerCapability(href: string): CapabilityKey | null {
  for (const [cap, routes] of Object.entries(CAPABILITY_ROUTES) as [CapabilityKey, string[]][]) {
    if (routes.some((r) => href === r || href.startsWith(r + '/'))) return cap;
  }
  return null;
}

// ¿Una ruta del menú es visible con este set de capacidades? Una ruta sin
// capacidad asociada (o en ALWAYS_VISIBLE) siempre se muestra.
export function canAccessRoute(href: string, capabilities: CapabilityKey[]): boolean {
  if (ALWAYS_VISIBLE.has(href)) return true;
  const cap = ownerCapability(href);
  if (!cap) return true;
  return capabilities.includes(cap);
}

export type RouteAccess = 'open' | 'locked' | 'hidden';

// Estado de una ruta del menú dado el rol y el plan:
//  - 'open': el usuario puede entrar.
//  - 'locked': su rol la permite pero el plan no la incluye → mostrar con 🔒.
//  - 'hidden': su rol no la permite → no se muestra.
// Una ruta sin capacidad asociada (o ALWAYS_VISIBLE) siempre está 'open'.
export function routeAccess(
  href: string,
  roleCaps: CapabilityKey[],
  planCaps: CapabilityKey[] | null,
): RouteAccess {
  if (ALWAYS_VISIBLE.has(href)) return 'open';
  const cap = ownerCapability(href);
  if (!cap) return 'open';
  if (!roleCaps.includes(cap)) return 'hidden';
  if (planCaps && !planCaps.includes(cap)) return 'locked';
  return 'open';
}
