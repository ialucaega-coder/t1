/**
 * Números de teléfono / WhatsApp de un negocio: formato canónico y guard
 * anti-hijack compartido.
 *
 * Por qué importa: los mensajes y llamadas ENTRANTES se asignan al tenant por
 * coincidencia exacta con `Business.phone` / `Business.whatsappNumber`
 * (`services/voice/client.ts`, `services/whatsapp/client.ts`). Si dos negocios
 * pudieran registrar el mismo número, el más viejo se quedaría con el tráfico del
 * otro. Por eso:
 *  - todo número se guarda en UN formato canónico (`+` + solo dígitos): sin esto
 *    '+54 9 11 2345-6789' y '+5491123456789' parecían números distintos y el guard
 *    no los veía como el mismo;
 *  - la comparación contra lo que ya está guardado ignora el formato (solo dígitos,
 *    también para filas viejas guardadas sin normalizar);
 *  - el chequeo y el guardado van en la MISMA transacción con un advisory lock por
 *    número (en orden, sin deadlock): dos negocios que registran el mismo número a
 *    la vez no pasan ambos.
 */
import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

const MIN_DIGITS = 7;
const MAX_DIGITS = 15; // E.164

/** Solo los dígitos de un número ya normalizado (o crudo). */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Formato canónico: `+` + dígitos. Acepta espacios, guiones, puntos, paréntesis y
 * los prefijos `tel:` / `whatsapp:`. Devuelve null si no es un número razonable
 * (letras, o menos de 7 / más de 15 dígitos).
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^(tel|whatsapp):/i, '')
    .replace(/[\s().\-]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+/, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return `+${digits}`;
}

/**
 * Normaliza un campo opcional de teléfono de un PATCH/PUT:
 *  - `undefined` → no vino (no se toca),
 *  - `null` o vacío → se borra (`null`),
 *  - número válido → su forma canónica,
 *  - inválido → AppError(400).
 */
export function normalizeOptionalPhone(value: string | null | undefined, label = 'teléfono'): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const normalized = normalizePhone(value);
  if (!normalized) throw new AppError(400, `El ${label} no es válido. Usá solo números con código de país (ej: +5491123456789).`);
  return normalized;
}

/**
 * Rechaza (409) si OTRO negocio ya usa alguno de los `numbers` (ya normalizados)
 * como phone o whatsappNumber. Debe llamarse DENTRO de la transacción que guarda el
 * número, antes del update: toma un advisory lock por número y compara solo por
 * dígitos (cubre filas viejas sin normalizar).
 */
export async function assertPhoneNumbersFree(
  tx: Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>,
  businessId: string,
  numbers: string[],
): Promise<void> {
  const digits = Array.from(new Set(numbers.map(phoneDigits).filter(Boolean))).sort();
  if (digits.length === 0) return;

  // Números de la PLATAFORMA (el WhatsApp/Twilio global): ningún negocio puede
  // registrarlos como suyos, o le robaría el tráfico entrante al resto. Se leen del
  // entorno; sin variable seteada no rechaza nada. (El negocio de DEFAULT_VOICE_BUSINESS_ID
  // ya queda protegido por la consulta de abajo: sus números son de OTRO negocio para
  // cualquier tercero que intente registrarlos.)
  const reserved = [process.env.TWILIO_PHONE_NUMBER].map((n) => phoneDigits((n ?? '').replace(/^whatsapp:/i, ''))).filter(Boolean);
  if (digits.some((d) => reserved.includes(d))) {
    throw new AppError(409, 'Ese número está reservado por la plataforma y no se puede usar.');
  }

  for (const d of digits) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'biznum:' + d}, 0))`;
  }

  const taken = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "businesses"
    WHERE id <> ${businessId}
      AND (
        regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY(${digits}::text[])
        OR regexp_replace(COALESCE("whatsappNumber", ''), '[^0-9]', '', 'g') = ANY(${digits}::text[])
      )
    LIMIT 1`;
  if (taken.length > 0) {
    throw new AppError(409, 'Ese número de teléfono/WhatsApp ya está en uso por otro negocio.');
  }
}
