/**
 * OTP de un solo uso para verificar el teléfono en reservas públicas.
 *
 * Sin cambios de schema: cada código vive en una fila Connection oculta
 * (type 'BOOKING_OTP', config { phone, codeHash, expiresAt, attempts }). Se
 * guarda HASHEADO (HMAC-SHA256 con el secreto del server), nunca en claro.
 * Persistir en DB (en vez de un cache en memoria) lo hace válido entre
 * instancias, clave para un despliegue horizontal.
 *
 * Verificación segura: expiración (10 min), tope de intentos (5), comparación
 * en tiempo constante, y borrado de la fila al primer éxito (un solo uso).
 */
import crypto from 'crypto';
import { prisma } from './prisma';
import type { Prisma } from '@prisma/client';

const OTP_TYPE = 'BOOKING_OTP';
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutos
const MAX_ATTEMPTS = 5;

interface OtpConfig {
  phone: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || 'dev-secret';
}

/** Hash HMAC del código, atado al negocio + teléfono (no reutilizable). */
function hashCode(businessId: string, phone: string, code: string): string {
  return crypto.createHmac('sha256', secret()).update(`${businessId}:${phone}:${code}`).digest('hex');
}

/** Genera un código numérico de 6 dígitos (con ceros a la izquierda). */
export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Crea (o reemplaza) el OTP de un teléfono para un negocio y devuelve el código
 * en claro para enviarlo por el canal (WhatsApp). El hash es lo único que se
 * persiste.
 */
export async function issueOtp(businessId: string, phone: string): Promise<string> {
  const code = generateOtpCode();
  const config: OtpConfig = {
    phone,
    codeHash: hashCode(businessId, phone, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };

  // Reemplaza cualquier OTP previo de ese teléfono (y limpia expirados).
  await prisma.connection.deleteMany({
    where: { businessId, type: OTP_TYPE, config: { path: ['phone'], equals: phone } },
  });
  await prisma.connection.create({
    data: {
      name: 'OTP de reserva',
      type: OTP_TYPE,
      icon: 'Shield',
      isActive: false,
      config: config as unknown as Prisma.InputJsonObject,
      businessId,
    },
  });

  return code;
}

export type OtpResult = 'ok' | 'invalid' | 'expired' | 'too_many_attempts' | 'not_found';

/**
 * Verifica un código. Consume el OTP (lo borra) sólo si es correcto. Incrementa
 * el contador de intentos en cada fallo y lo invalida al superar el tope.
 */
export async function verifyOtp(businessId: string, phone: string, code: string): Promise<OtpResult> {
  const row = await prisma.connection.findFirst({
    where: { businessId, type: OTP_TYPE, config: { path: ['phone'], equals: phone } },
    orderBy: { id: 'desc' },
    select: { id: true, config: true },
  });
  if (!row) return 'not_found';

  const cfg = row.config as unknown as OtpConfig;

  if (Date.now() > cfg.expiresAt) {
    await prisma.connection.delete({ where: { id: row.id } });
    return 'expired';
  }
  if ((cfg.attempts ?? 0) >= MAX_ATTEMPTS) {
    await prisma.connection.delete({ where: { id: row.id } });
    return 'too_many_attempts';
  }

  const expected = Buffer.from(cfg.codeHash, 'hex');
  const actual = Buffer.from(hashCode(businessId, phone, String(code || '')), 'hex');
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!match) {
    await prisma.connection.update({
      where: { id: row.id },
      data: { config: { ...cfg, attempts: (cfg.attempts ?? 0) + 1 } as unknown as Prisma.InputJsonObject },
    });
    return 'invalid';
  }

  // Éxito: consumimos el OTP (un solo uso).
  await prisma.connection.delete({ where: { id: row.id } });
  return 'ok';
}

/**
 * ¿La plataforma exige verificar el teléfono en reservas públicas? Opt-in por
 * env y sólo si hay un canal para enviar el código (WhatsApp/Twilio). Default
 * off para no romper negocios que no lo configuraron.
 */
export function publicBookingRequiresOtp(canSend: boolean): boolean {
  return process.env.PUBLIC_BOOKING_REQUIRE_OTP === 'true' && canSend;
}
