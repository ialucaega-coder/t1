/**
 * Integración con Cal.com (agenda externa).
 *
 * Permite que el negocio conecte su cuenta de Cal.com para que las reservas
 * creadas en Local B se reflejen también en su calendario real de Cal.com.
 *
 * Persistencia sin tocar el schema: una `Connection` (type='CALCOM') por negocio
 * guarda en `config` la API key (CIFRADA con lib/crypto) y el eventTypeId
 * elegido. Mismo patrón de fila única con `SELECT ... FOR UPDATE` que
 * brand/voice/gallery para evitar lost-update.
 */
import { prisma } from '../../lib/prisma';
import { encrypt, decrypt } from '../../lib/crypto';

const CALCOM_CONNECTION_TYPE = 'CALCOM';
const CALCOM_CONNECTION_NAME = 'Cal.com';

/** Config persistida (la API key viaja/queda cifrada). */
interface StoredCalcomConfig {
  apiKeyEnc?: string;
  eventTypeId?: number;
  enabled?: boolean;
}

/** Estado seguro para el panel: nunca expone la API key. */
export interface CalcomStatus {
  connected: boolean;
  enabled: boolean;
  eventTypeId: number | null;
}

/** Config descifrada para uso interno (no se devuelve por la API). */
export interface CalcomConfig {
  apiKey: string;
  eventTypeId: number | null;
  enabled: boolean;
}

function parse(config: unknown): StoredCalcomConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as StoredCalcomConfig;
}

/** Estado de la conexión Cal.com del negocio (sin exponer la key). */
export async function getCalcomStatus(businessId: string): Promise<CalcomStatus> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CALCOM_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  return {
    connected: Boolean(cfg.apiKeyEnc),
    enabled: Boolean(cfg.enabled && cfg.apiKeyEnc),
    eventTypeId: typeof cfg.eventTypeId === 'number' ? cfg.eventTypeId : null,
  };
}

/** Devuelve la config descifrada (o null si no está conectado). Uso interno. */
export async function loadCalcomConfig(businessId: string): Promise<CalcomConfig | null> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CALCOM_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  if (!cfg.apiKeyEnc) return null;
  try {
    return {
      apiKey: decrypt(cfg.apiKeyEnc),
      eventTypeId: typeof cfg.eventTypeId === 'number' ? cfg.eventTypeId : null,
      enabled: Boolean(cfg.enabled),
    };
  } catch {
    // Key corrupta o clave de cifrado cambiada: tratamos como desconectado.
    return null;
  }
}

/** Guarda/actualiza la conexión Cal.com (cifra la API key). Atómico (FOR UPDATE). */
export async function saveCalcomConfig(
  businessId: string,
  patch: { apiKey?: string; eventTypeId?: number | null; enabled?: boolean },
): Promise<CalcomStatus> {
  await prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: CALCOM_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: CALCOM_CONNECTION_NAME,
          type: CALCOM_CONNECTION_TYPE,
          icon: 'Calendar',
          isActive: true,
          config: {},
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const current = parse(fresh?.config);
    const next: StoredCalcomConfig = { ...current };

    if (patch.apiKey !== undefined) next.apiKeyEnc = encrypt(patch.apiKey);
    if (patch.eventTypeId !== undefined) {
      next.eventTypeId = patch.eventTypeId === null ? undefined : patch.eventTypeId;
    }
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    // Conectar implica habilitar por defecto.
    if (patch.apiKey !== undefined && patch.enabled === undefined) next.enabled = true;

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as unknown as object, isActive: true },
    });
  });

  return getCalcomStatus(businessId);
}

/** Desconecta Cal.com: borra la key y deshabilita. */
export async function disconnectCalcom(businessId: string): Promise<void> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CALCOM_CONNECTION_TYPE },
    select: { id: true },
  });
  if (!conn) return;
  await prisma.connection.update({
    where: { id: conn.id },
    data: { config: {}, isActive: false },
  });
}
