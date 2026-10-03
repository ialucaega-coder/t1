/**
 * Pruebas del cifrado simétrico en reposo (`src/lib/crypto.ts`): round-trip
 * AES-256-GCM y los helpers de migración perezosa (isEncrypted / safeDecrypt),
 * que permiten convivir con secretos legados en texto plano.
 */
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted, safeDecrypt } from '../../lib/crypto';

describe('lib/crypto', () => {
  it('encrypt/decrypt hace round-trip', () => {
    const secreto = 'mi-api-key-super-secreta-123';
    const enc = encrypt(secreto);
    expect(enc).not.toContain(secreto);
    expect(enc.split(':').length).toBe(3);
    expect(decrypt(enc)).toBe(secreto);
  });

  it('decrypt lanza con formato inválido', () => {
    expect(() => decrypt('no-es-cifrado')).toThrow();
  });

  it('isEncrypted reconoce solo valores producidos por encrypt', () => {
    expect(isEncrypted(encrypt('x'))).toBe(true);
    expect(isEncrypted('texto plano')).toBe(false);
    // Un botToken de Telegram (contiene ":") NO debe confundirse con cifrado.
    expect(isEncrypted('123456789:AAE-abc_DEF-ghi')).toBe(false);
    // Tres partes pero IV/tag de largo incorrecto tampoco cuenta.
    expect(isEncrypted('a:b:c')).toBe(false);
  });

  it('safeDecrypt descifra lo cifrado y deja pasar lo legado (texto plano)', () => {
    expect(safeDecrypt(encrypt('nueva'))).toBe('nueva');
    expect(safeDecrypt('clave-legada-en-texto-plano')).toBe('clave-legada-en-texto-plano');
    expect(safeDecrypt('123456789:AAE-token-telegram')).toBe('123456789:AAE-token-telegram');
  });
});
