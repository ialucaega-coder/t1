/**
 * CRM liviano de clientes: etiquetas (tags) y notas por cliente.
 *
 * Mejora de ingeniería inversa del módulo de Contactos de respond.io y de las
 * etiquetas/notas de SalesMartly: el negocio arma un catálogo de etiquetas
 * (con color) y se las asigna a sus clientes, más una nota interna por cliente.
 * Sirve para segmentar (filtrar por etiqueta) y para que el equipo deje contexto.
 *
 * Persistencia: schema de Prisma congelado, así que guardamos todo en el modelo
 * `Connection` con type='CLIENT_CRM' (un registro por negocio), reutilizando
 * `config Json?`. Mismo patrón que la Voz de Marca (BRAND) y la FAQ (FAQ_KB).
 *
 * Nota de escala: es un único JSON por negocio. Para volúmenes de beta/PyME
 * (cientos a pocos miles de clientes) es más que suficiente; si un negocio
 * creciera a decenas de miles de clientes etiquetados, esto migraría a tablas
 * propias (requiere descongelar el schema; ver project_localb_constraints).
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';

const CRM_CONNECTION_TYPE = 'CLIENT_CRM';
const CRM_CONNECTION_NAME = 'CRM de clientes';

/** Topes defensivos (evitan un JSON gigante y un prompt/UX inmanejable). */
export const MAX_TAGS = 50;
export const MAX_TAG_LABEL_LEN = 40;
export const MAX_NOTE_LEN = 2000;
export const MAX_TAGS_PER_CLIENT = 20;

/** Colores permitidos para las etiquetas (alineados con la paleta del panel). */
export const TAG_COLORS = [
  'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];
const DEFAULT_TAG_COLOR: TagColor = 'slate';

/** Una etiqueta del catálogo del negocio. */
export interface ClientTag {
  id: string;
  label: string;
  color: TagColor;
}

/** Anotación por cliente: etiquetas asignadas (por id) y nota interna. */
export interface ClientAnnotation {
  tags: string[];
  note: string;
}

/** Estado completo del CRM de un negocio. */
export interface ClientCrm {
  /** Catálogo de etiquetas disponibles. */
  tags: ClientTag[];
  /** Anotaciones por clientId. */
  byClient: Record<string, ClientAnnotation>;
}

const EMPTY_CRM: ClientCrm = { tags: [], byClient: {} };

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function sanitizeColor(value: unknown): TagColor {
  return typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value)
    ? (value as TagColor)
    : DEFAULT_TAG_COLOR;
}

/** Normaliza el catálogo de etiquetas: descarta sin label, recorta, dedup por id, tope. */
export function sanitizeTags(raw: unknown): ClientTag[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientTag[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const label = clampText(e.label, MAX_TAG_LABEL_LEN);
    if (!label) continue;
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 64) : randomUUID();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, color: sanitizeColor(e.color) });
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Normaliza el estado completo del CRM. Las asignaciones de cada cliente se
 * filtran contra el catálogo (no se guardan ids de etiquetas inexistentes).
 */
export function sanitizeCrm(raw: unknown): ClientCrm {
  const cfg =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tags = sanitizeTags(cfg.tags);
  const validTagIds = new Set(tags.map((t) => t.id));

  const byClient: Record<string, ClientAnnotation> = {};
  const rawByClient =
    cfg.byClient && typeof cfg.byClient === 'object' && !Array.isArray(cfg.byClient)
      ? (cfg.byClient as Record<string, unknown>)
      : {};

  for (const [clientId, value] of Object.entries(rawByClient)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const tagIds = Array.isArray(v.tags)
      ? [...new Set(v.tags.filter((t): t is string => typeof t === 'string' && validTagIds.has(t)))].slice(
          0,
          MAX_TAGS_PER_CLIENT,
        )
      : [];
    const note = clampText(v.note, MAX_NOTE_LEN);
    // No guardamos clientes sin nada (mantiene el JSON chico).
    if (tagIds.length === 0 && !note) continue;
    byClient[clientId.slice(0, 64)] = { tags: tagIds, note };
  }

  return { tags, byClient };
}

/** Devuelve el CRM del negocio (vacío si no hay). */
export async function loadClientCrm(businessId: string): Promise<ClientCrm> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CRM_CONNECTION_TYPE },
  });
  return conn ? sanitizeCrm(conn.config) : { ...EMPTY_CRM };
}

async function persist(businessId: string, mutate: (current: ClientCrm) => ClientCrm): Promise<ClientCrm> {
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: CRM_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      const next = mutate({ ...EMPTY_CRM });
      conn = await tx.connection.create({
        data: {
          name: CRM_CONNECTION_NAME,
          type: CRM_CONNECTION_TYPE,
          icon: 'Tags',
          isActive: true,
          config: next as unknown as object,
          businessId,
        },
        select: { id: true },
      });
      return next;
    }

    // Bloqueo de fila para no pisar un guardado concurrente (dos tabs / dos
    // miembros del equipo etiquetando a la vez). Mismo patrón que brand/faq.
    await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const next = mutate(sanitizeCrm(fresh?.config));
    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as unknown as object, isActive: true },
    });
    return next;
  });
}

/** Reemplaza el catálogo de etiquetas. Las asignaciones a etiquetas borradas se limpian. */
export async function saveTags(businessId: string, tags: unknown): Promise<ClientCrm> {
  return persist(businessId, (current) => sanitizeCrm({ tags, byClient: current.byClient }));
}

/** Setea las etiquetas de un cliente (reemplaza su lista, no mergea). */
export async function setClientTags(
  businessId: string,
  clientId: string,
  tagIds: string[],
): Promise<ClientAnnotation> {
  const next = await persist(businessId, (current) => {
    const prev = current.byClient[clientId] ?? { tags: [], note: '' };
    return sanitizeCrm({
      tags: current.tags,
      byClient: { ...current.byClient, [clientId]: { ...prev, tags: tagIds } },
    });
  });
  return next.byClient[clientId] ?? { tags: [], note: '' };
}

/** Setea la nota interna de un cliente. */
export async function setClientNote(
  businessId: string,
  clientId: string,
  note: string,
): Promise<ClientAnnotation> {
  const next = await persist(businessId, (current) => {
    const prev = current.byClient[clientId] ?? { tags: [], note: '' };
    return sanitizeCrm({
      tags: current.tags,
      byClient: { ...current.byClient, [clientId]: { ...prev, note } },
    });
  });
  return next.byClient[clientId] ?? { tags: [], note: '' };
}
