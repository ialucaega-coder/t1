/**
 * Códigos de recuperación del 2FA (un solo uso), sin cambios de schema.
 *
 * Si alguien pierde el celular con la app de autenticación queda fuera de su
 * cuenta. Al activar el 2FA se emiten RECOVERY_CODE_COUNT códigos aleatorios de
 * un solo uso: cada uno reemplaza a un código TOTP en el login (y en los
 * endpoints /2fa/*) y se invalida al usarse.
 *
 * Persistencia (schema congelado): una fila `Connection` por negocio con
 * type='TWO_FACTOR_RECOVERY' y config `{ codes: { [userId]: string[] } }`, donde
 * cada string es el HASH (SHA-256) de un código. Nunca se guarda un código en
 * claro: se muestra una sola vez al emitirlo. Los códigos tienen 50 bits de
 * entropía, por lo que un hash rápido alcanza (no hay diccionario que atacar) y
 * los intentos fallidos igual cuentan para el bloqueo de cuenta en el login.
 *
 * Concurrencia: lectura-modificación-escritura dentro de una transacción
 * serializada por el advisory lock del singleton + FOR UPDATE, para que dos
 * logins simultáneos no consuman el mismo código dos veces.
 */
import { createHash, randomInt } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { lockSingleton } from '../../lib/singletonLock';
import { verifyTwoFactorToken } from '../twoFactor';

const RECOVERY_TYPE = 'TWO_FACTOR_RECOVERY';
const RECOVERY_NAME = 'Códigos de recuperación 2FA';

export const RECOVERY_CODE_COUNT = 10;
const CODE_LENGTH = 10;
// Sin 0/O/1/I/L/U para que sea fácil de transcribir a mano.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

type CodesMap = Record<string, string[]>;

function hashCode(userId: string, normalized: string): string {
  return createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
}

/** Genera un código legible tipo `K7M2P-X9QDA`. */
function randomCode(): string {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * Normaliza lo que tipeó el usuario (mayúsculas, sin guiones ni espacios).
 * Devuelve null si no tiene la forma de un código de recuperación.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(cleaned) ? cleaned : null;
}

function readMap(config: unknown): CodesMap {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const raw =
    cfg.codes && typeof cfg.codes === 'object' && !Array.isArray(cfg.codes)
      ? (cfg.codes as Record<string, unknown>)
      : {};
  const out: CodesMap = {};
  for (const [uid, list] of Object.entries(raw)) {
    if (Array.isArray(list)) out[uid] = list.filter((h): h is string => typeof h === 'string');
  }
  return out;
}

/**
 * Lee-modifica-escribe el mapa de hashes bajo lock. `mutate` recibe el mapa y
 * devuelve el resultado que quiere propagar; si lo marca como cambiado se
 * persiste.
 */
async function withMap<T>(
  businessId: string,
  mutate: (map: CodesMap) => { result: T; changed: boolean },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockSingleton(tx, businessId, RECOVERY_TYPE);
    const existing = await tx.connection.findFirst({
      where: { businessId, type: RECOVERY_TYPE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    let id = existing?.id;
    if (!id) {
      const created = await tx.connection.create({
        data: {
          name: RECOVERY_NAME,
          type: RECOVERY_TYPE,
          icon: 'KeyRound',
          isActive: true,
          config: { codes: {} } as Prisma.InputJsonObject,
          businessId,
        },
        select: { id: true },
      });
      id = created.id;
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id }, select: { config: true } });
    const map = readMap(fresh?.config);
    const { result, changed } = mutate(map);
    if (changed) {
      await tx.connection.update({
        where: { id },
        data: { config: { codes: map } as Prisma.InputJsonObject, isActive: true },
      });
    }
    return result;
  });
}

/**
 * Emite un juego nuevo de códigos y descarta los anteriores. Devuelve los códigos
 * EN CLARO: es la única vez que existen fuera del hash, hay que mostrarlos ya.
 */
export async function generateRecoveryCodes(businessId: string, userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  const hashes = codes.map((c) => hashCode(userId, normalizeRecoveryCode(c) as string));
  await withMap(businessId, (map) => {
    map[userId] = hashes;
    return { result: undefined, changed: true };
  });
  return codes;
}

/**
 * Consume un código de recuperación. true si era válido (y queda invalidado),
 * false si no existe o ya se usó.
 */
export async function consumeRecoveryCode(businessId: string, userId: string, input: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return false;
  const hash = hashCode(userId, normalized);
  return withMap(businessId, (map) => {
    const list = map[userId] ?? [];
    const idx = list.indexOf(hash);
    if (idx === -1) return { result: false, changed: false };
    map[userId] = list.filter((_, i) => i !== idx);
    return { result: true, changed: true };
  });
}

/** Cuántos códigos sin usar le quedan al usuario. */
export async function countRecoveryCodes(businessId: string, userId: string): Promise<number> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: RECOVERY_TYPE },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  return (readMap(conn?.config)[userId] ?? []).length;
}

/** Borra todos los códigos del usuario (al desactivar el 2FA). */
export async function clearRecoveryCodes(businessId: string, userId: string): Promise<void> {
  await withMap(businessId, (map) => {
    if (!(userId in map)) return { result: undefined, changed: false };
    delete map[userId];
    return { result: undefined, changed: true };
  });
}

export type SecondFactorKind = 'totp' | 'recovery';

/**
 * Valida el segundo factor: un código TOTP de 6 dígitos o un código de
 * recuperación. Devuelve cuál fue, o null si no vale ninguno. Un código de
 * recuperación válido SE CONSUME acá.
 */
export async function verifySecondFactor(params: {
  businessId: string;
  userId: string;
  encryptedSecret: string;
  code: string;
}): Promise<SecondFactorKind | null> {
  const { businessId, userId, encryptedSecret, code } = params;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    return verifyTwoFactorToken(encryptedSecret, trimmed) ? 'totp' : null;
  }
  return (await consumeRecoveryCode(businessId, userId, trimmed)) ? 'recovery' : null;
}
