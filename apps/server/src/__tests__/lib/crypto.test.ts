/**
 * Pruebas del cifrado simétrico (`src/lib/crypto.ts`), usado para el secreto
 * TOTP en reposo. Verifica round-trip, que el texto cifrado no filtra el plano,
 * que cada cifrado usa un IV distinto, y que la autenticación GCM detecta
 * manipulación / formato inválido.
 */
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../lib/crypto';

describe('lib/crypto', () => {
  it('descifra lo que cifró (round-trip)', () => {
    const plano = 'JBSWY3DPEHPK3PXP';
    expect(decrypt(encrypt(plano))).toBe(plano);
  });

  it('no deja el texto plano visible en el cifrado', () => {
    const plano = 'secreto-super-sensible';
    expect(encrypt(plano)).not.toContain(plano);
  });

  it('usa un IV aleatorio: dos cifrados del mismo texto difieren', () => {
    const plano = 'mismo-valor';
    expect(encrypt(plano)).not.toBe(encrypt(plano));
  });

  it('lanza si el formato del cifrado es inválido', () => {
    expect(() => decrypt('no-tiene-tres-partes')).toThrow();
  });

  it('lanza si el texto cifrado fue manipulado (autenticación GCM)', () => {
    const enc = encrypt('dato');
    const [iv, tag, ct] = enc.split(':');
    // Alteramos el ciphertext: el authTag ya no valida.
    const tampered = `${iv}:${tag}:${Buffer.from('otracosa').toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
