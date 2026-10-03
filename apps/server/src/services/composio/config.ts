/**
 * Integración con Composio (https://composio.dev): plataforma que conecta cientos
 * de apps/herramientas (Gmail, Slack, GitHub, Notion, etc.) a agentes de IA vía
 * una API unificada.
 *
 * Guarda la API key de Composio (CIFRADA) para poder validar la cuenta y, a
 * futuro, exponer herramientas al bot. Persistencia sin tocar el schema:
 * Connection(type='COMPOSIO'), mismo patrón FOR UPDATE que calcom/mercadopago/manychat.
 */
import { prisma } from '../../lib/prisma';
import { encrypt, decrypt } from '../../lib/crypto';

const CMP_CONNECTION_TYPE = 'COMPOSIO';
const CMP_CONNECTION_NAME = 'Composio';

interface StoredCmpConfig {
  apiKeyEnc?: string;
  enabled?: boolean;
}

/** Estado seguro para el panel: nunca expone la API key. */
export interface CmpStatus {
  connected: boolean;
  enabled: boolean;
}

/** Config descifrada para uso interno (no se devuelve por la API). */
export interface CmpConfig {
  apiKey: string;
  enabled: boolean;
}

function parse(config: unknown): StoredCmpConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as StoredCmpConfig;
}

/** Estado de la conexión Composio (sin exponer la key). */
export async function getCmpStatus(businessId: string): Promise<CmpStatus> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CMP_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  return {
    connected: Boolean(cfg.apiKeyEnc),
    enabled: Boolean(cfg.enabled && cfg.apiKeyEnc),
  };
}

/** Devuelve la config descifrada (o null si no está conectado). Uso interno. */
export async function loadCmpConfig(businessId: string): Promise<CmpConfig | null> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CMP_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  if (!cfg.apiKeyEnc) return null;
  try {
    return { apiKey: decrypt(cfg.apiKeyEnc), enabled: Boolean(cfg.enabled) };
  } catch {
    return null;
  }
}

/** Guarda/actualiza la conexión Composio (cifra la API key). Atómico (FOR UPDATE). */
export async function saveCmpConfig(
  businessId: string,
  patch: { apiKey?: string; enabled?: boolean },
): Promise<CmpStatus> {
  await prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: CMP_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: CMP_CONNECTION_NAME,
          type: CMP_CONNECTION_TYPE,
          icon: 'Plug',
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
    const next: StoredCmpConfig = { ...parse(fresh?.config) };

    if (patch.apiKey !== undefined) next.apiKeyEnc = encrypt(patch.apiKey);
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.apiKey !== undefined && patch.enabled === undefined) next.enabled = true;

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as unknown as object, isActive: true },
    });
  });

  return getCmpStatus(businessId);
}

/** Desconecta Composio: borra la key y deshabilita. */
export async function disconnectCmp(businessId: string): Promise<void> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CMP_CONNECTION_TYPE },
    select: { id: true },
  });
  if (!conn) return;
  await prisma.connection.update({
    where: { id: conn.id },
    data: { config: {}, isActive: false },
  });
}
