/**
 * Hashing de contraseñas: Argon2id con backward-compat para hashes bcrypt.
 *
 * Migramos de bcrypt a Argon2id (recomendación OWASP #1: memory-hard, resistente
 * a cracking por GPU/ASIC). Para no invalidar las contraseñas ya guardadas con
 * bcrypt, `verifyPassword` detecta el algoritmo por el prefijo del hash y, cuando
 * valida un hash bcrypt legado, señala `needsRehash` para que el caller lo
 * reescriba a Argon2id de forma perezosa en el próximo login exitoso.
 *
 * Parámetros Argon2id: mínimo OWASP (m=19 MiB, t=2, p=1). Suben el costo de
 * cracking sin penalizar de más el login en instancias chicas.
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

// Argon2id es el algoritmo por defecto de @node-rs/argon2 (no referenciamos el
// const enum `Algorithm` porque no es accesible bajo `isolatedModules`). Params
// = mínimo OWASP: m=19 MiB, t=2, p=1.
const ARGON_OPTS = {
  memoryCost: 19456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash de una contraseña en claro con Argon2id. */
export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTS);
}

/**
 * Hash Argon2id fijo (de un valor descartable) con los mismos parámetros que
 * `ARGON_OPTS`. Sirve para `equalizeVerifyTiming`: correr un verify real cuando
 * el usuario NO existe, para que el tiempo de respuesta no delate si el email
 * está registrado (enumeración por timing).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$zG1mLfj2ANAqWL4qjly8oA$35K0eRYKEvps7o8s92ApNRHtmDSltuBEDLHtN7Nm/Gc';

/** Consume ~el mismo tiempo que un verify real, descartando el resultado. */
export async function equalizeVerifyTiming(): Promise<void> {
  try {
    await argonVerify(DUMMY_HASH, 'no-match');
  } catch {
    /* no-op: solo nos interesa el costo de tiempo, no el resultado */
  }
}

export interface VerifyResult {
  /** La contraseña coincide con el hash guardado. */
  valid: boolean;
  /** El hash es de un algoritmo viejo (bcrypt) y conviene reescribirlo a Argon2id. */
  needsRehash: boolean;
}

/**
 * Verifica una contraseña contra el hash guardado, detectando el algoritmo.
 * - bcrypt (`$2a$`/`$2b$`/`$2y$`): valida y marca needsRehash si coincide.
 * - Argon2 (`$argon2…`): valida con Argon2id.
 * - Cualquier otro formato (p. ej. placeholders sin login): nunca valida.
 * Nunca lanza: un hash corrupto o ilegible devuelve `valid: false`.
 */
export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<VerifyResult> {
  if (!stored || typeof plain !== 'string') return { valid: false, needsRehash: false };

  if (/^\$2[aby]\$/.test(stored)) {
    // bcrypt.compare puede rechazar si el hash guardado está corrupto (rounds o
    // largo inválidos); lo envolvemos para cumplir el contrato "nunca lanza".
    try {
      const valid = await bcrypt.compare(plain, stored);
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  if (stored.startsWith('$argon2')) {
    try {
      const valid = await argonVerify(stored, plain);
      return { valid, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  return { valid: false, needsRehash: false };
}
