/**
 * Mr Go — estado persistente de la OFICINA (el piso).
 *
 * El arreglo del piso (qué agente va en qué zona/puesto) es DETERMINÍSTICO a
 * partir de los agentes activos (ver `agents.ts` + el layout del front), así que
 * lo que hace falta persistir es el estado operativo que el dueño cambia a mano:
 * qué agentes están EN PAUSA (foco visual del piso). Hasta ahora eso vivía solo
 * en el cliente y se perdía al recargar.
 *
 * Persistencia: schema CONGELADO → guardamos en el modelo `Connection` con
 * type='MRGO_OFFICE' (un registro por negocio), reutilizando `config Json?`.
 * Mismo patrón que Agentes (MRGO_AGENTS), Memoria (MRGO_MEMORY) y Workflows:
 * transacción + SELECT ... FOR UPDATE al escribir para no pisar guardados
 * concurrentes (lost-update). Multi-tenant por `businessId`.
 */
import { prisma } from '../../lib/prisma';
import { AGENT_KEYS } from './agents';
import { lockSingleton } from '../../lib/singletonLock';

const OFFICE_CONNECTION_TYPE = 'MRGO_OFFICE';
const OFFICE_CONNECTION_NAME = 'Oficina de Mr Go';
const AGENT_SET: ReadonlySet<string> = new Set(AGENT_KEYS);

/** Posición de un puesto en el piso, en % del alto/ancho (0–100). */
export interface DeskPosition {
  x: number;
  y: number;
}

/** Estado persistente de la oficina. */
export interface OfficeState {
  /** Claves de agentes EN PAUSA (foco visual del piso). */
  paused: string[];
  /**
   * Posiciones personalizadas de los puestos (editor drag-and-drop), por clave
   * de agente. Si un agente no está acá, su puesto se calcula automáticamente.
   */
  positions: Record<string, DeskPosition>;
}

/** Recorta un número a [0,100] con 2 decimales; null si no es finito. */
function clampPct(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;
}

/**
 * Normaliza/valida el estado entrante: descarta claves fuera del catálogo,
 * deduplica, mantiene el orden canónico del catálogo; sanea las posiciones
 * (clave válida + x/y en [0,100]). Determinístico y defensivo. Nunca lanza.
 */
export function sanitizeOffice(raw: unknown): OfficeState {
  const cfg =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(cfg.paused) ? cfg.paused : [];
  const valid = new Set<string>();
  for (const k of list) {
    if (typeof k === 'string' && AGENT_SET.has(k)) valid.add(k);
  }

  // Posiciones personalizadas: solo claves del catálogo con x/y válidos.
  const positions: Record<string, DeskPosition> = {};
  const rawPos = cfg.positions;
  if (rawPos && typeof rawPos === 'object' && !Array.isArray(rawPos)) {
    for (const [key, val] of Object.entries(rawPos as Record<string, unknown>)) {
      if (!AGENT_SET.has(key) || !val || typeof val !== 'object') continue;
      const x = clampPct((val as Record<string, unknown>).x);
      const y = clampPct((val as Record<string, unknown>).y);
      if (x !== null && y !== null) positions[key] = { x, y };
    }
  }

  // Orden canónico del catálogo (estable para la UI).
  return { paused: AGENT_KEYS.filter((k) => valid.has(k)), positions };
}

/** Devuelve el estado persistente de la oficina del negocio (pausas). */
export async function loadOffice(businessId: string): Promise<OfficeState> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: OFFICE_CONNECTION_TYPE },
    orderBy: { id: 'asc' },
  });
  return sanitizeOffice(conn?.config);
}

/**
 * Persiste el estado de la oficina del negocio.
 *
 * Atómico: transacción con `SELECT ... FOR UPDATE` para no pisar un guardado
 * concurrente. Crea el registro Connection si no existe. Devuelve el estado
 * saneado que quedó vigente. Mismo patrón que `saveAgents`/`saveMemory`.
 */
export async function saveOffice(businessId: string, office: unknown): Promise<OfficeState> {
  const clean = sanitizeOffice(office);
  return prisma.$transaction(async (tx) => {
    await lockSingleton(tx, businessId, OFFICE_CONNECTION_TYPE);
    let conn = await tx.connection.findFirst({
      where: { businessId, type: OFFICE_CONNECTION_TYPE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: OFFICE_CONNECTION_NAME,
          type: OFFICE_CONNECTION_TYPE,
          icon: 'Building2',
          isActive: true,
          config: clean as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
      await tx.connection.update({
        where: { id: conn.id },
        data: { config: clean as unknown as object, isActive: true },
      });
    }
    return clean;
  });
}
