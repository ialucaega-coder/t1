/**
 * Solicitudes de integración.
 *
 * Varias integraciones del catálogo (Google Calendar, HubSpot, Sheets, etc.)
 * todavía no están implementadas. En vez de un botón "Conectar" muerto, el
 * negocio puede "Solicitarla" y queda registrado su interés (lista de espera).
 *
 * Persistencia: schema congelado → se guarda en `Connection` con
 * type='INTEGRATION_REQUESTS' (un registro por negocio), reutilizando
 * `config Json?`. Mismo patrón que la Voz de Marca y los permisos del equipo.
 */
import { prisma } from '../../lib/prisma';

const CONNECTION_TYPE = 'INTEGRATION_REQUESTS';
const CONNECTION_NAME = 'Solicitudes de integración';

function normalize(config: unknown): string[] {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config))
    ? (config as Record<string, unknown>)
    : {};
  const raw = Array.isArray(cfg.requested) ? cfg.requested : [];
  const set = new Set(raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0));
  return [...set];
}

/** Devuelve las integraciones solicitadas por el negocio. */
export async function loadIntegrationRequests(businessId: string): Promise<string[]> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CONNECTION_TYPE },
  });
  return normalize(conn?.config);
}

/**
 * Agrega o quita una integración de la lista de solicitudes (idempotente).
 * Atómico: transacción + `SELECT ... FOR UPDATE` para no pisar solicitudes
 * concurrentes. Devuelve la lista resultante.
 */
export async function toggleIntegrationRequest(
  businessId: string,
  name: string,
  requested: boolean,
): Promise<string[]> {
  const clean = name.trim().slice(0, 100);
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: CONNECTION_NAME,
          type: CONNECTION_TYPE,
          icon: 'Link2',
          isActive: true,
          config: { requested: [] } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const set = new Set(normalize(fresh?.config));
    if (requested) set.add(clean); else set.delete(clean);
    const next = [...set];

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { requested: next } as unknown as object, isActive: true },
    });
    return next;
  });
}
