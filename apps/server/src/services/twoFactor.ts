/**
 * Autenticación en dos pasos (2FA) por TOTP (RFC 6238), compatible con Google
 * Authenticator, Authy, 1Password, etc.
 *
 * Flujo:
 *  1. setup: se genera un secreto, se guarda CIFRADO en User.twoFactorSecret y
 *     se devuelve el otpauth:// + un QR (data URL) para escanear. En este punto
 *     twoFactorEnabled sigue en false (2FA todavía no activo).
 *  2. verify: el usuario ingresa el primer código; si valida, se pone
 *     twoFactorEnabled = true.
 *  3. login: si el usuario tiene 2FA activo, además de la contraseña debe
 *     mandar un código TOTP válido.
 *
 * El secreto nunca viaja ni se guarda en texto plano (ver lib/crypto.ts).
 */
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { encrypt, decrypt } from '../lib/crypto';

const ISSUER = 'Local B';

// Tolerancia de 1 ventana (±30s) para absorber desfasajes de reloj del cliente.
authenticator.options = { window: 1 };

export interface TwoFactorSetup {
  /** Secreto cifrado, listo para persistir en User.twoFactorSecret. */
  encryptedSecret: string;
  /** URI otpauth:// para apps de autenticación. */
  otpauthUri: string;
  /** QR como data URL (image/png) para mostrar en el panel. */
  qrDataUrl: string;
}

/** Genera un secreto nuevo + su QR para un usuario (identificado por email). */
export async function generateTwoFactorSetup(accountName: string): Promise<TwoFactorSetup> {
  const secret = authenticator.generateSecret();
  const otpauthUri = authenticator.keyuri(accountName, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri);
  return { encryptedSecret: encrypt(secret), otpauthUri, qrDataUrl };
}

/**
 * Verifica un código TOTP contra un secreto CIFRADO. Devuelve false (sin lanzar)
 * si el código es inválido o si el secreto no se puede descifrar.
 */
export function verifyTwoFactorToken(encryptedSecret: string, token: string): boolean {
  try {
    const secret = decrypt(encryptedSecret);
    return authenticator.verify({ token: token.trim(), secret });
  } catch {
    return false;
  }
}
