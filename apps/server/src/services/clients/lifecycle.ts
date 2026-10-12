/**
 * Ciclo de vida de contactos (CRM lifecycle) estilo respond.io.
 *
 * Cada cliente avanza por un embudo de etapas: New → Hot → Payment → Customer.
 * Sirve para ver el pipeline comercial (cuántos contactos hay en cada etapa) y
 * para que el equipo mueva a un cliente de "nuevo" a "cliente" a medida que la
 * relación avanza. Es una mejora sobre el CRM liviano actual (etiquetas + notas).
 *
 * Persistencia: el schema de Prisma está congelado, así que guardamos la etapa
 * de cada cliente en el modelo `Connection` con type='CRM_LIFECYCLE' (un registro
 * por negocio), reutilizando el campo `config Json?`. Mismo patrón que los
 * Permisos del equipo (TEAM_PERMISSIONS), la Voz de Marca (BRAND) y el CRM de
 * etiquetas (CLIENT_CRM).
 *
 * El config es un mapa plano `{ [clientId]: 'NEW' | 'HOT' | 'PAYMENT' | 'CUSTOMER' }`.
 * Si un cliente no está en el mapa, su etapa por defecto es 'NEW' (no escribimos
 * la etapa por defecto para mantener el JSON chico).
 */
import { prisma } from '../../lib/prisma';

const LIFECYCLE_CONNECTION_TYPE = 'CRM_LIFECYCLE';
const LIFECYCLE_CONNECTION_NAME = 'Ciclo de vida de clientes';

/** Etapas del embudo, en orden. El orden es el que se muestra en la UI. */
export const LIFECYCLE_STAGES = ['NEW', 'HOT', 'PAYMENT', 'CUSTOMER'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Etapa por defecto cuando un cliente no tiene etapa seteada. */
export const DEFAULT_STAGE: LifecycleStage = 'NEW';

const STAGE_SET: ReadonlySet<string> = new Set(LIFECYCLE_STAGES);

/** Mapa clientId → etapa del embudo. */
export type LifecycleMap = Record<string, LifecycleStage>;

/** Verifica si un valor arbitrario es una etapa válida. */
export function isLifecycleStage(value: unknown): value is LifecycleStage {
  return typeof value === 'string' && STAGE_SET.has(value);
}

/** Normaliza un valor arbitrario a una etapa; cae a 'NEW' ante algo desconocido. */
export function normalizeStage(value: unknown): LifecycleStage {
  return isLifecycleStage(value) ? value : DEFAULT_STAGE;
}

/**
 * Normaliza el mapa de etapas: descarta entradas cuya etapa no esté en el set
 * válido (y entradas que no sean strings). Mismo espíritu que
 * `sanitizeCapabilities` en permissions.ts. No guardamos la etapa por defecto
 * ('NEW') para mantener el JSON mínimo.
 */
export function sanitizeLifecycleMap(config: unknown): LifecycleMap {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const raw =
    cfg.stages && typeof cfg.stages === 'object' && !Array.isArray(cfg.stages)
      ? (cfg.stages as Record<string, unknown>)
      : {};
  const out: LifecycleMap = {};
  for (const [clientId, stage] of Object.entries(raw)) {
    if (!isLifecycleStage(stage)) continue; // clave fuera del set válido → se descarta
    if (stage === DEFAULT_STAGE) continue; // no persistimos el default
    out[clientId.slice(0, 64)] = stage;
  }
  return out;
}

/** Etapa de un cliente dado el mapa; 'NEW' si no está seteada. */
export function stageFor(map: LifecycleMap, clientId: string): LifecycleStage {
  return map[clientId] ?? DEFAULT_STAGE;
}

/** Devuelve el mapa de etapas del negocio (vacío si no hay). */
export async function loadLifecycle(businessId: string): Promise<LifecycleMap> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: LIFECYCLE_CONNECTION_TYPE },
  });
  return sanitizeLifecycleMap(conn?.config);
}

/**
 * Setea la etapa de un cliente. Setear 'NEW' borra la entrada (vuelve al default).
 *
 * Atómico: corre en transacción y bloquea la fila con `SELECT ... FOR UPDATE`
 * antes de re-leer y mergear, para no pisar etapas de otros clientes si dos
 * guardados concurren (lost-update). Mismo patrón que permissions.ts / crm.ts.
 *
 * Devuelve la etapa efectiva resultante para ese cliente.
 */
export async function setClientStage(
  businessId: string,
  clientId: string,
  stage: LifecycleStage,
): Promise<LifecycleStage> {
  const clean = normalizeStage(stage);

  await prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: LIFECYCLE_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      const stages: LifecycleMap = {};
      if (clean !== DEFAULT_STAGE) stages[clientId] = clean;
      conn = await tx.connection.create({
        data: {
          name: LIFECYCLE_CONNECTION_NAME,
          type: LIFECYCLE_CONNECTION_TYPE,
          icon: 'Filter',
          isActive: true,
          config: { stages } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
      return;
    }

    await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const stages = sanitizeLifecycleMap(fresh?.config);

    if (clean === DEFAULT_STAGE) {
      delete stages[clientId];
    } else {
      stages[clientId] = clean;
    }

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { stages } as unknown as object, isActive: true },
    });
  });

  return clean;
}

/** Conteo por etapa (embudo). Cada stage arranca en 0. */
export type FunnelCounts = Record<LifecycleStage, number>;

function emptyCounts(): FunnelCounts {
  return { NEW: 0, HOT: 0, PAYMENT: 0, CUSTOMER: 0 };
}

/**
 * Embudo del negocio: cuenta cuántos clientes hay en cada etapa. Los clientes
 * sin etapa seteada cuentan como 'NEW'. Scope multi-tenant por businessId.
 *
 * Nota de escala: carga los ids de clientes del negocio en memoria para cruzar
 * contra el mapa (ignorando ids obsoletos de clientes borrados). Para volúmenes
 * de beta/PyME es suficiente; misma consideración que el CRM de etiquetas.
 */
export async function getFunnel(
  businessId: string,
): Promise<{ counts: FunnelCounts; total: number; stages: readonly LifecycleStage[] }> {
  const map = await loadLifecycle(businessId);
  const clients = await prisma.user.findMany({
    where: { businessId, role: 'CLIENT', deletedAt: null },
    select: { id: true },
  });
  const counts = emptyCounts();
  for (const c of clients) counts[stageFor(map, c.id)]++;
  return { counts, total: clients.length, stages: LIFECYCLE_STAGES };
}
