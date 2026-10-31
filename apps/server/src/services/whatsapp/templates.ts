import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';

/**
 * Plantillas WhatsApp oficiales (HSM — Highly Structured Messages).
 *
 * Gap de competencia: el ciclo de plantillas aprobadas por Meta que habilita el
 * broadcast fuera de la ventana de 24h. Flujo: redactar (DRAFT) → clasificar
 * (UTILITY/MARKETING/AUTHENTICATION) → enviar a aprobación (PENDING) →
 * aprobar/rechazar (APPROVED/REJECTED). Esto NO es el `Template`/`/api/templates`
 * existente (ese es texto libre genérico); esto son las HSM oficiales.
 *
 * Persistencia: el schema de Prisma está CONGELADO, así que guardamos todo en el
 * modelo `Connection` (campo `config` Json) con un registro singleton por
 * negocio, `type = 'WA_TEMPLATES'` y `config = { templates: WaTemplate[] }`.
 * Mismo patrón EXACTO que services/brand/config.ts y services/gallery/config.ts
 * (transacción + `SELECT ... FOR UPDATE` + re-lectura fresca antes de mergear;
 * crea el registro si no existe).
 */

export const WA_TEMPLATES_TYPE = 'WA_TEMPLATES';
const WA_TEMPLATES_NAME = 'Plantillas WhatsApp';

export type WaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type WaTemplateStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type WaButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

export interface WaTemplateButton {
  type: WaButtonType;
  /** Etiqueta del botón (1..25 chars). */
  text: string;
  /** URL o teléfono según type (vacío/ausente para QUICK_REPLY). */
  value?: string;
}

export interface WaTemplate {
  id: string;                    // crypto.randomUUID() server-side
  name: string;                  // Meta exige /^[a-z0-9_]{1,512}$/ (minúsculas + _)
  language: string;              // ej 'es_AR' | 'es' | 'en' (no vacío)
  category: WaTemplateCategory;
  status: WaTemplateStatus;
  header?: string;               // encabezado de texto opcional (<=60 chars)
  body: string;                  // cuerpo, variables {{1}} {{2}}... (1..1024 chars)
  footer?: string;               // pie opcional (<=60 chars)
  buttons?: WaTemplateButton[];  // 0..3
  example?: string[];            // ejemplos para {{1..n}} (Meta los exige para aprobar)
  rejectionReason?: string;      // sólo cuando status=REJECTED
  createdAt: string;             // ISO
  updatedAt: string;             // ISO
  submittedAt?: string;          // cuándo pasó a PENDING
  reviewedAt?: string;           // cuándo pasó a APPROVED/REJECTED
}

/** Regex de Meta para el nombre de plantilla: minúsculas, dígitos y guión bajo. */
export const WA_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;

/** Valida el nombre de plantilla contra la regla de Meta. */
export function isValidTemplateName(name: string): boolean {
  return WA_TEMPLATE_NAME_RE.test(name);
}

/**
 * Cuenta las variables `{{1}}`, `{{2}}`, … del cuerpo. Las variables deben ser
 * CONSECUTIVAS desde 1 (sin saltos, sin `{{0}}`). Devuelve el índice máximo =
 * cantidad de variables (0 si no hay). Tira `AppError(400)` con mensaje claro
 * si encuentra `{{0}}` o un hueco en la numeración.
 */
export function parseVariableCount(body: string): number {
  const indices = new Set<number>();
  for (const match of body.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(match[1]);
    if (n === 0) {
      throw new AppError(400, 'Las variables deben numerarse desde {{1}}: encontré {{0}}.');
    }
    indices.add(n);
  }
  if (indices.size === 0) return 0;

  const max = Math.max(...indices);
  for (let i = 1; i <= max; i++) {
    if (!indices.has(i)) {
      throw new AppError(
        400,
        `Las variables deben ser consecutivas desde {{1}}: falta {{${i}}} (encontré hasta {{${max}}}).`,
      );
    }
  }
  return max;
}

/** Serializa la lista de plantillas al tipo JSON que espera Prisma. */
function toConfig(templates: WaTemplate[]): Prisma.InputJsonValue {
  return { templates } as unknown as Prisma.InputJsonValue;
}

/** Normaliza el config crudo de la Connection a una lista de plantillas válida. */
function parseTemplates(config: unknown): WaTemplate[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const raw = (config as { templates?: unknown }).templates;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is WaTemplate =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as WaTemplate).id === 'string' &&
      typeof (t as WaTemplate).name === 'string' &&
      typeof (t as WaTemplate).body === 'string',
  );
}

/** Devuelve las plantillas del negocio ordenadas por `updatedAt` desc. */
export async function loadWaTemplates(businessId: string): Promise<WaTemplate[]> {
  const connection = await prisma.connection.findFirst({
    where: { businessId, type: WA_TEMPLATES_TYPE },
    orderBy: { id: 'asc' },
  });
  if (!connection) return [];
  const templates = parseTemplates(connection.config);
  return templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Aplica una mutación a la lista de plantillas de forma atómica.
 *
 * Corre dentro de una transacción y bloquea la fila de la Connection con
 * `SELECT ... FOR UPDATE`, re-leyendo el array fresco antes de mutar, de modo
 * que dos escrituras concurrentes (dos tabs, doble click, reintentos) se
 * serialicen y no se pisen (evita lost-update). Crea el registro singleton si
 * todavía no existe. Mismo patrón que services/gallery/config.ts::mutateGallery.
 *
 * Si el callback tira (ej: `AppError(404/409/422)`), la transacción hace
 * rollback y no persiste nada; el error se propaga al errorHandler.
 */
export async function mutateWaTemplates<T>(
  businessId: string,
  mutate: (templates: WaTemplate[]) => { templates: WaTemplate[]; result: T },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: WA_TEMPLATES_TYPE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: WA_TEMPLATES_NAME,
          type: WA_TEMPLATES_TYPE,
          icon: 'MessageSquare',
          config: toConfig([]),
          isActive: false,
          businessId,
        },
        select: { id: true },
      });
    } else {
      // Bloquea la fila hasta el fin de la transacción.
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({
      where: { id: conn.id },
      select: { config: true },
    });
    const templates = parseTemplates(fresh?.config);
    const { templates: next, result } = mutate(templates);

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: toConfig(next) },
    });

    return result;
  });
}
