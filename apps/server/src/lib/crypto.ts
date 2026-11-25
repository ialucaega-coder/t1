/**
 * Cifrado simétrico para secretos en reposo (AES-256-GCM).
 *
 * Se usa para el secreto TOTP de 2FA: si la base de datos se filtrara, el
 * secreto no queda en texto plano (sin la clave de la app no se puede generar
 * códigos válidos). La clave se deriva por SHA-256 de ENCRYPTION_KEY (o, como
 * fallback, NEXTAUTH_SECRET), de modo que siempre resulta de 32 bytes.
 *
 * Formato del texto cifrado: `iv:authTag:ciphertext`, cada parte en base64.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getEncryptionSecret } from './secrets';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // recomendado para GCM

/** Deriva una clave de 32 bytes a partir del secreto de entorno. */
function getKey(): Buffer {
  return createHash('sha256').update(getEncryptionSecret()).digest();
}

/** Cifra un texto plano y devuelve `iv:authTag:ciphertext` (base64). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Descifra un valor producido por `encrypt`. Lanza si el formato es inválido o
 * si la autenticación GCM falla (dato manipulado o clave incorrecta).
 */
export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Formato de texto cifrado inválido');
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * ¿`value` tiene el formato de un texto cifrado por `encrypt`? Valida que sean
 * 3 partes base64 y que el IV y el authTag tengan el largo exacto (12 y 16
 * bytes). Así un secreto legado en texto plano que contenga ":" (p. ej. el
 * botToken de Telegram `123:ABC`) NO se confunde con un valor cifrado.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    return iv.length === IV_BYTES && tag.length === 16;
  } catch {
    return false;
  }
}

/**
 * Descifra si el valor está cifrado; si no (secreto legado en texto plano),
 * lo devuelve tal cual. Permite migración perezosa: los valores viejos se leen
 * sin romper y se re-cifran al guardarse la próxima vez.
 */
export function safeDecrypt(value: string): string {
  return isEncrypted(value) ? decrypt(value) : value;
}
