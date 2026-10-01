/**
 * Integración con MercadoPago (pagos — Checkout Pro).
 *
 * Permite que el negocio conecte su cuenta de MercadoPago para generar links de
 * cobro (preferencias de pago) y mandárselos al cliente por WhatsApp/chat.
 * Alternativa a Stripe, más relevante en LATAM.
 *
 * Persistencia sin tocar el schema: una `Connection` (type='MERCADOPAGO') por
 * negocio guarda en `config` el access token (CIFRADO con lib/crypto). Mismo
 * patrón de fila única con `SELECT ... FOR UPDATE` que calcom/brand/voice.
 */
import { prisma } from '../../lib/prisma';
import { encrypt, decrypt } from '../../lib/crypto';

const MP_CONNECTION_TYPE = 'MERCADOPAGO';
const MP_CONNECTION_NAME = 'MercadoPago';

interface StoredMpConfig {
  accessTokenEnc?: string;
  /** Moneda por defecto para los cobros (ARS, MXN, BRL, etc.). */
  currency?: string;
  enabled?: boolean;
}

/** Estado seguro para el panel: nunca expone el access token. */
export interface MpStatus {
  connected: boolean;
  enabled: boolean;
  currency: string;
}

/** Config descifrada para uso interno (no se devuelve por la API). */
export interface MpConfig {
  accessToken: string;
  currency: string;
  enabled: boolean;
}

const DEFAULT_CURRENCY = 'ARS';

function parse(config: unknown): StoredMpConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return config as StoredMpConfig;
}

/** Estado de la conexión MercadoPago (sin exponer el token). */
export async function getMpStatus(businessId: string): Promise<MpStatus> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MP_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  return {
    connected: Boolean(cfg.accessTokenEnc),
    enabled: Boolean(cfg.enabled && cfg.accessTokenEnc),
    currency: typeof cfg.currency === 'string' && cfg.currency ? cfg.currency : DEFAULT_CURRENCY,
  };
}

/** Devuelve la config descifrada (o null si no está conectado). Uso interno. */
export async function loadMpConfig(businessId: string): Promise<MpConfig | null> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MP_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = parse(conn?.config);
  if (!cfg.accessTokenEnc) return null;
  try {
    return {
      accessToken: decrypt(cfg.accessTokenEnc),
      currency: typeof cfg.currency === 'string' && cfg.currency ? cfg.currency : DEFAULT_CURRENCY,
      enabled: Boolean(cfg.enabled),
    };
  } catch {
    return null;
  }
}

/** Guarda/actualiza la conexión MercadoPago (cifra el token). Atómico (FOR UPDATE). */
export async function saveMpConfig(
  businessId: string,
  patch: { accessToken?: string; currency?: string; enabled?: boolean },
): Promise<MpStatus> {
  await prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: MP_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: MP_CONNECTION_NAME,
          type: MP_CONNECTION_TYPE,
          icon: 'CreditCard',
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
    const next: StoredMpConfig = { ...parse(fresh?.config) };

    if (patch.accessToken !== undefined) next.accessTokenEnc = encrypt(patch.accessToken);
    if (patch.currency !== undefined) next.currency = patch.currency;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.accessToken !== undefined && patch.enabled === undefined) next.enabled = true;

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as unknown as object, isActive: true },
    });
  });

  return getMpStatus(businessId);
}

/** Desconecta MercadoPago: borra el token y deshabilita. */
export async function disconnectMp(businessId: string): Promise<void> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MP_CONNECTION_TYPE },
    select: { id: true },
  });
  if (!conn) return;
  await prisma.connection.update({
    where: { id: conn.id },
    data: { config: {}, isActive: false },
  });
}
