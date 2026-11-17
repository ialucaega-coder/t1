/**
 * Cobros con MercadoPago: referencia propia, registro del cobro y confirmación
 * del pago (webhook) de forma segura e idempotente.
 *
 * Flujo:
 *  1. Al generar el link (POST /payment-link) creamos una `external_reference`
 *     propia (`cobro:<businessId>:<uuid>`), la mandamos a MercadoPago junto con
 *     una `notification_url` pública y guardamos el cobro (fila Connection oculta,
 *     sin tocar el schema).
 *  2. Cuando MercadoPago avisa por la `notification_url`, NO confiamos en el
 *     cuerpo: consultamos el pago real a la API con el access token DE ESE negocio.
 *     Si MercadoPago no lo reconoce, no pasa nada (anti-falsificación).
 *  3. Solo con status `approved` y una external_reference que coincide con un cobro
 *     nuestro de ese negocio, registramos UNA Transaction (SALE), de forma
 *     atómica e idempotente por id de pago (reintentos de MercadoPago no duplican).
 *
 * Multi-tenant: el negocio se toma de la URL firmada por nosotros (la
 * notification_url lleva el businessId), se cruza con el prefijo de la
 * external_reference y el token usado es el del propio negocio.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import {
  idempotencyLockKey,
  findIdempotentEntityId,
  recordIdempotentKey,
} from '../../lib/idempotency';
import { recordAuditEvent } from '../../middleware/audit';
import { dispatchEvent } from '../workflows';
import { fetchPayment, type MpPayment } from './client';
import type { MpConfig } from './config';
import { findCobro, parseExternalReference, MP_PAYMENT_IDEMP_TYPE } from './cobros';

// Helpers de cobro (viven en ./cobros para evitar un import circular con workflows).
export { MP_COBRO_TYPE, MP_PAYMENT_IDEMP_TYPE, MP_ROWS_TTL_DAYS, buildExternalReference, parseExternalReference, buildNotificationUrl, recordCobro } from './cobros';
export type { CobroRecord } from './cobros';

/** Método de pago del enum existente. Convención del POS: "QR / MercadoPago" = QR. */
export function mapPaymentMethod(paymentType: string | null): 'CARD' | 'TRANSFER' | 'QR' {
  switch (paymentType) {
    case 'credit_card':
    case 'debit_card':
    case 'prepaid_card':
      return 'CARD';
    case 'bank_transfer':
      return 'TRANSFER';
    default:
      return 'QR'; // dinero en cuenta de MercadoPago, billetera, etc.
  }
}

export type PaymentOutcome =
  | { result: 'registered'; transactionId: string }
  | { result: 'duplicate' }
  | { result: 'rate_limited' }
  | { result: 'ignored'; reason: string };

/** Motivos de "ignorado" que indican un aviso falso o ajeno (cuentan como intento inválido). */
export const SUSPICIOUS_REASONS = new Set([
  'pago_no_reconocido',
  'referencia_ajena',
  'cobro_desconocido',
  'moneda_distinta',
]);

/**
 * Procesa la notificación de un pago. `cfg` es la config del negocio (ya cargada
 * por la ruta). Lanza `MpTransientError` (o un error de DB) si conviene que
 * MercadoPago reintente; en cualquier otro caso devuelve el resultado.
 */
export async function processPaymentNotification(
  businessId: string,
  cfg: MpConfig,
  paymentId: string,
  /**
   * Se llama una vez que MercadoPago reconoció el pago (aviso verificado) y que NO
   * es un duplicado de un pago ya registrado. Si devuelve false se corta con
   * `rate_limited`: así el tope por negocio solo cuenta avisos reales y nuevos, y no
   * se puede agotar con avisos falsos ni con repeticiones de pagos ya procesados.
   */
  onVerified?: () => Promise<boolean>,
): Promise<PaymentOutcome> {
  if (!cfg.enabled) return { result: 'ignored', reason: 'mercadopago_deshabilitado' };

  // Verificación anti-falsificación: el pago tiene que existir en la cuenta de
  // MercadoPago de ESTE negocio (se consulta con su propio token).
  const payment: MpPayment | null = await fetchPayment(cfg.accessToken, paymentId);
  if (!payment || payment.id !== paymentId) return { result: 'ignored', reason: 'pago_no_reconocido' };

  // Un pago ya registrado (reintento de MercadoPago o reenvío de un aviso real) es
  // un duplicado: se responde ANTES de contar el tope por negocio, así las
  // repeticiones de pagos legítimos no consumen el cupo de avisos nuevos.
  const key = `mp:${payment.id}`;
  if (await findIdempotentEntityId(prisma, businessId, MP_PAYMENT_IDEMP_TYPE, key)) {
    return { result: 'duplicate' };
  }
  if (onVerified && !(await onVerified())) return { result: 'rate_limited' };

  if (payment.status !== 'approved') return { result: 'ignored', reason: `estado_${payment.status || 'desconocido'}` };

  const parsed = parseExternalReference(payment.externalReference);
  if (!parsed || parsed.businessId !== businessId) return { result: 'ignored', reason: 'referencia_ajena' };

  const cobro = await findCobro(businessId, payment.externalReference as string);
  if (!cobro) return { result: 'ignored', reason: 'cobro_desconocido' };

  if (!(payment.amount > 0)) return { result: 'ignored', reason: 'monto_invalido' };

  // La moneda tiene que coincidir con la del cobro: Transaction no guarda moneda,
  // así que registrar otra mezclaría importes de monedas distintas.
  if (cobro.currency && (payment.currency ?? '').toUpperCase() !== cobro.currency) {
    console.warn('[mercadopago] moneda del pago distinta a la del cobro: no se registra', {
      businessId,
      paymentId: payment.id,
      esperada: cobro.currency,
      recibida: payment.currency,
    });
    return { result: 'ignored', reason: 'moneda_distinta' };
  }
  // Si el monto difiere del esperado se registra el real (es lo que cobró el
  // negocio) pero se deja constancia en el log.
  const amountDiffers = cobro.amount !== undefined && Math.abs(cobro.amount - payment.amount) > 0.005;
  if (amountDiffers) {
    console.warn('[mercadopago] el monto cobrado difiere del esperado: se registra el real', {
      businessId,
      paymentId: payment.id,
      esperado: cobro.amount,
      cobrado: payment.amount,
    });
  }

  const notes =
    `Cobro con MercadoPago (pago #${payment.id})` +
    (cobro.description ? ` — ${cobro.description}` : '') +
    (payment.currency ? ` [${payment.currency}]` : '');

  // Alta atómica + idempotente: el advisory lock serializa reintentos
  // concurrentes del mismo pago y la clave se registra en la MISMA transacción
  // que el movimiento (si algo falla, no queda consumida y el reintento sirve).
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(MP_PAYMENT_IDEMP_TYPE, businessId, key)}, 0))`;
    const dup = await findIdempotentEntityId(tx, businessId, MP_PAYMENT_IDEMP_TYPE, key);
    if (dup) return { duplicate: true as const };

    const txn = await tx.transaction.create({
      data: {
        amount: payment.amount,
        type: 'SALE',
        paymentMethod: mapPaymentMethod(payment.paymentType),
        reference: key,
        notes,
        businessId,
      },
      select: { id: true, amount: true, paymentMethod: true },
    });
    await recordIdempotentKey(tx, businessId, MP_PAYMENT_IDEMP_TYPE, key, txn.id);
    return { duplicate: false as const, txn };
  });

  if (outcome.duplicate) return { result: 'duplicate' };

  // Auditoría sin datos sensibles (ni token, ni datos del pagador).
  recordAuditEvent({
    type: 'DATA_CREATE',
    resource: 'mercadopago.payment',
    businessId,
    metadata: {
      paymentId: payment.id,
      transactionId: outcome.txn.id,
      ...(amountDiffers ? { expectedAmount: cobro.amount, paidAmount: payment.amount } : {}),
    },
  });

  // "Pago recibido" para las automatizaciones, igual que el cobro manual.
  void dispatchEvent(businessId, {
    trigger: 'pago_recibido',
    payload: {
      transactionId: outcome.txn.id,
      amount: Number(outcome.txn.amount),
      paymentMethod: outcome.txn.paymentMethod,
    },
  }).catch(() => undefined);

  return { result: 'registered', transactionId: outcome.txn.id };
}

/**
 * Verifica la cabecera `x-signature` de MercadoPago (HMAC-SHA256 hex).
 * Manifiesto según la documentación de MercadoPago:
 *   `id:<data.id en minúsculas>;request-id:<x-request-id>;ts:<ts>;`
 * (las partes ausentes se omiten). SUPUESTO sin verificar contra MercadoPago real.
 */
export function verifyMpSignature(opts: {
  secret: string;
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  const header = opts.signatureHeader;
  if (!header) return false;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const [k, ...rest] = part.split('=');
    const value = rest.join('=').trim();
    if (k.trim() === 'ts') ts = value;
    else if (k.trim() === 'v1') v1 = value;
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;

  let manifest = '';
  if (opts.dataId) manifest += `id:${opts.dataId.toLowerCase()};`;
  if (opts.requestId) manifest += `request-id:${opts.requestId};`;
  manifest += `ts:${ts};`;

  const expected = crypto.createHmac('sha256', opts.secret).update(manifest).digest();
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
