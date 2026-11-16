/**
 * Cobros de MercadoPago: referencia propia, URL del webhook y registro del cobro.
 *
 * Módulo liviano (solo prisma + crypto) a propósito: lo usan tanto la ruta de
 * links de cobro como las acciones de automatización (services/actions), y no
 * puede depender de `services/workflows` (importa las acciones: sería circular).
 * `payments.ts` lo re-exporta.
 */
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/** Scope (Connection.type) de los cobros generados: key = external_reference. */
export const MP_COBRO_TYPE = 'MERCADOPAGO_COBRO';

/** Scope de idempotencia por pago de MercadoPago: key = `mp:<paymentId>`. */
export const MP_PAYMENT_IDEMP_TYPE = 'MERCADOPAGO_PAYMENT';

/**
 * Cuánto se conservan las filas MERCADOPAGO_COBRO y MERCADOPAGO_PAYMENT antes de
 * que las purgue services/maintenance/purge.ts. Los links de Checkout Pro que
 * generamos NO vencen (no mandamos `expires`), así que un cliente puede pagar
 * semanas después: pasado este plazo ese pago ya no se reconoce y se ignora. La
 * clave de idempotencia del pago tiene el MISMO plazo (y nace después que el cobro),
 * así siempre sobrevive al cobro: un aviso tardío repetido no puede duplicar la venta.
 */
export const MP_ROWS_TTL_DAYS = 180;

const REF_PREFIX = 'cobro';

/** external_reference nuevo: incluye el negocio y un id único e irrepetible del cobro. */
export function buildExternalReference(businessId: string): string {
  return `${REF_PREFIX}:${businessId}:${crypto.randomUUID()}`;
}

/** Inversa de `buildExternalReference`. Devuelve null si no es una referencia nuestra. */
export function parseExternalReference(ref: string | null | undefined): { businessId: string; cobroId: string } | null {
  if (!ref) return null;
  const m = /^cobro:([A-Za-z0-9_-]{1,64}):([0-9a-f-]{36})$/.exec(ref);
  return m ? { businessId: m[1], cobroId: m[2] } : null;
}

/**
 * URL pública del webhook de ESTE negocio, o undefined si el server no tiene una
 * base pública configurada (en local MercadoPago no podría llamarla igual).
 * La base sale de API_PUBLIC_URL (o FRONTEND_URL, igual que el webhook de
 * Telegram); no hay dominios hardcodeados.
 */
export function buildNotificationUrl(businessId: string): string | undefined {
  const base = (process.env.API_PUBLIC_URL || process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return undefined;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(base)) return undefined;
  return `${base}/api/mercadopago/webhook/${businessId}`;
}

export interface CobroRecord {
  preferenceId: string;
  amount: number;
  currency: string;
  description: string;
}

/** Guarda el cobro generado para poder reconocerlo cuando llegue el pago. */
export async function recordCobro(businessId: string, ref: string, cobro: CobroRecord): Promise<void> {
  await prisma.connection.create({
    data: {
      name: 'Cobro MercadoPago',
      type: MP_COBRO_TYPE,
      icon: 'CreditCard',
      isActive: false,
      config: {
        key: ref,
        entityId: cobro.preferenceId,
        amount: cobro.amount,
        currency: cobro.currency,
        description: cobro.description,
      } as Prisma.InputJsonObject,
      businessId,
    },
  });
}

/**
 * Busca un cobro nuestro por su external_reference. Filtra SIEMPRE por
 * businessId + type (cubierto por el índice [businessId, type] de Connection)
 * antes del filtro JSON, así el escaneo queda acotado a los cobros de ese negocio.
 */
export async function findCobro(
  businessId: string,
  ref: string,
): Promise<{ description?: string; amount?: number; currency?: string } | null> {
  const row = await prisma.connection.findFirst({
    where: { businessId, type: MP_COBRO_TYPE, config: { path: ['key'], equals: ref } },
    select: { config: true },
  });
  if (!row) return null;
  const cfg = (row.config ?? {}) as { description?: unknown; amount?: unknown; currency?: unknown };
  return {
    description: typeof cfg.description === 'string' ? cfg.description : undefined,
    amount: typeof cfg.amount === 'number' && Number.isFinite(cfg.amount) ? cfg.amount : undefined,
    currency: typeof cfg.currency === 'string' && cfg.currency ? cfg.currency.toUpperCase() : undefined,
  };
}
