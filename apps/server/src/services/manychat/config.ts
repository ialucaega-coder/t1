/**
 * Integración con ManyChat (vía alternativa de conexión a WhatsApp/Instagram/
 * Messenger a través de la plataforma ManyChat).
 *
 * Guarda la API key de ManyChat (CIFRADA) para poder validar la cuenta y enviar
 * mensajes a suscriptores vía la API de ManyChat. Persistencia sin tocar el
 * schema: Connection(type='MANYCHAT'), patrón FOR UPDATE como calcom/mercadopago.
 */
import { prisma } from '../../lib/prisma';
import { encrypt, decrypt } from '../../lib/crypto';

const MC_CONNECTION_TYPE = 'MANYCHAT';
const MC_CONNECTION_NAME = 'ManyChat';

interface StoredMcConfig {
  apiKeyEnc?: string;
  enabled?: boolean;
}

/** Estado seguro para el panel: nunca expone la API key. */
export interface McStatus {
  connected: boolean;
  enabled: boolean;
}

/** Config descifrada para uso interno (no se devuelve por la API). */
export interface McConfig {
  apiKey: string;
  enabled: boolean;
}

function parse(config: unknown): StoredMcConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as StoredMcConfig;
}

/** Estado de la conexión ManyChat (sin exponer la key). */
export async function getMcStatus(businessId: string): Promise<McStatus> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MC_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  return {
    connected: Boolean(cfg.apiKeyEnc),
    enabled: Boolean(cfg.enabled && cfg.apiKeyEnc),
  };
}

/** Devuelve la config descifrada (o null si no está conectado). Uso interno. */
export async function loadMcConfig(businessId: string): Promise<McConfig | null> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MC_CONNECTION_TYPE },
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

/** Guarda/actualiza la conexión ManyChat (cifra la API key). Atómico (FOR UPDATE). */
export async function saveMcConfig(
  businessId: string,
  patch: { apiKey?: string; enabled?: boolean },
): Promise<McStatus> {
  await prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: MC_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: MC_CONNECTION_NAME,
          type: MC_CONNECTION_TYPE,
          icon: 'MessageCircle',
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
    const next: StoredMcConfig = { ...parse(fresh?.config) };

    if (patch.apiKey !== undefined) next.apiKeyEnc = encrypt(patch.apiKey);
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.apiKey !== undefined && patch.enabled === undefined) next.enabled = true;

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as unknown as object, isActive: true },
    });
  });

  return getMcStatus(businessId);
}

/** Desconecta ManyChat: borra la key y deshabilita. */
export async function disconnectMc(businessId: string): Promise<void> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MC_CONNECTION_TYPE },
    select: { id: true },
  });
  if (!conn) return;
  await prisma.connection.update({
    where: { id: conn.id },
    data: { config: {}, isActive: false },
  });
}
