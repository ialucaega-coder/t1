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

const OFFICE_CONNECTION_TYPE = 'MRGO_OFFICE';
const OFFICE_CONNECTION_NAME = 'Oficina de Mr Go';
const AGENT_SET: ReadonlySet<string> = new Set(AGENT_KEYS);

/** Estado persistente de la oficina. */
export interface OfficeState {
  /** Claves de agentes EN PAUSA (foco visual del piso). */
  paused: string[];
}

/**
 * Normaliza/valida el estado entrante: descarta claves fuera del catálogo,
 * deduplica, mantiene el orden canónico del catálogo. Determinístico y
 * defensivo (datos de API). Nunca lanza.
 */
export function sanitizeOffice(raw: unknown): OfficeState {
  const cfg =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(cfg.paused) ? cfg.paused : [];
  const valid = new Set<string>();
  for (const k of list) {
    if (typeof k === 'string' && AGENT_SET.has(k)) valid.add(k);
  }
  // Orden canónico del catálogo (estable para la UI).
  return { paused: AGENT_KEYS.filter((k) => valid.has(k)) };
}

/** Devuelve el estado persistente de la oficina del negocio (pausas). */
export async function loadOffice(businessId: string): Promise<OfficeState> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: OFFICE_CONNECTION_TYPE },
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
    let conn = await tx.connection.findFirst({
      where: { businessId, type: OFFICE_CONNECTION_TYPE },
      select: { id: true },
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
