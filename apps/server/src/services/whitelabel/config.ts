/**
 * Servicio de configuración de UI del panel White Label.
 *
 * El nombre, logo, colores y dominio de la marca viven en columnas reales del
 * modelo `Business` (ver routes/whitelabel.ts). Pero el *estilo del panel*
 * (tema visual) y las *secciones ocultas* para el cliente de la agencia no
 * tienen columna y el schema de Prisma está congelado, así que se persisten en
 * el modelo `Connection` con type='WHITELABEL_UI' (un registro por negocio),
 * reutilizando el campo `config Json?`. Mismo patrón que la Voz de Marca
 * (type='BRAND') y los permisos de equipo (type='TEAM_PERMISSIONS').
 */
import { prisma } from '../../lib/prisma';

const WHITELABEL_CONNECTION_TYPE = 'WHITELABEL_UI';
const WHITELABEL_CONNECTION_NAME = 'Panel White Label';

/** Temas visuales disponibles para el panel del cliente. */
export const WHITELABEL_THEMES = ['nimbus', 'onyx', 'terra'] as const;
export type WhitelabelTheme = (typeof WHITELABEL_THEMES)[number];

/** Secciones del panel que la agencia puede ocultarle a su cliente. */
export const WHITELABEL_SECTIONS = ['Costos', 'Configuración IA', 'Arena', 'Marketplace'] as const;

/** Config de UI editable del panel White Label de un negocio. */
export interface WhitelabelUi {
  /** Tema visual del panel (nimbus | onyx | terra). */
  theme: WhitelabelTheme;
  /** Secciones ocultas para el cliente (subconjunto de WHITELABEL_SECTIONS). */
  hiddenSections: string[];
}

/** Valores por defecto cuando el negocio todavía no personalizó el panel. */
export const DEFAULT_WHITELABEL_UI: WhitelabelUi = {
  theme: 'onyx',
  hiddenSections: [],
};

function normalizeTheme(value: unknown): WhitelabelTheme {
  return (WHITELABEL_THEMES as readonly string[]).includes(value as string)
    ? (value as WhitelabelTheme)
    : DEFAULT_WHITELABEL_UI.theme;
}

/** Filtra a secciones válidas y deduplica, para no guardar basura. */
export function sanitizeHiddenSections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(WHITELABEL_SECTIONS as readonly string[]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && valid.has(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function normalize(config: unknown): WhitelabelUi {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config))
    ? (config as Record<string, unknown>)
    : {};
  return {
    theme: normalizeTheme(cfg.theme),
    hiddenSections: sanitizeHiddenSections(cfg.hiddenSections),
  };
}

/** Devuelve la config de UI del panel (o los valores por defecto). */
export async function loadWhitelabelUi(businessId: string): Promise<WhitelabelUi> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: WHITELABEL_CONNECTION_TYPE },
  });
  return normalize(conn?.config);
}

/**
 * Guarda (merge) un parche parcial de la config de UI. Crea el registro
 * Connection type='WHITELABEL_UI' si todavía no existe.
 *
 * Atómico: corre en una transacción y bloquea la fila con `SELECT ... FOR
 * UPDATE`, re-leyendo el config fresco antes de mergear el parche, para evitar
 * lost-updates entre dos guardados concurrentes. Mismo patrón que brand/config.
 */
export async function saveWhitelabelUi(
  businessId: string,
  patch: Partial<WhitelabelUi>,
): Promise<WhitelabelUi> {
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: WHITELABEL_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: WHITELABEL_CONNECTION_NAME,
          type: WHITELABEL_CONNECTION_TYPE,
          icon: 'Palette',
          isActive: true,
          config: DEFAULT_WHITELABEL_UI as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const current = normalize(fresh?.config);
    const next: WhitelabelUi = {
      theme: patch.theme !== undefined ? normalizeTheme(patch.theme) : current.theme,
      hiddenSections: patch.hiddenSections !== undefined
        ? sanitizeHiddenSections(patch.hiddenSections)
        : current.hiddenSections,
    };

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as unknown as object, isActive: true },
    });
    return next;
  });
}
