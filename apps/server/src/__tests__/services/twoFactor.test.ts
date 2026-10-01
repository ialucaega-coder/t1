/**
 * Pruebas del servicio 2FA/TOTP (`src/services/twoFactor.ts`): generación del
 * setup (secreto cifrado + otpauth + QR) y verificación de códigos contra el
 * secreto cifrado (válido, inválido y secreto corrupto).
 */
import { describe, it, expect } from 'vitest';
import { authenticator } from 'otplib';
import { encrypt } from '../../lib/crypto';
import { generateTwoFactorSetup, verifyTwoFactorToken } from '../../services/twoFactor';

describe('services/twoFactor', () => {
  describe('generateTwoFactorSetup', () => {
    it('devuelve secreto cifrado, otpauth y QR data URL', async () => {
      const setup = await generateTwoFactorSetup('ana@example.com');

      expect(setup.encryptedSecret).toContain(':'); // formato iv:tag:ct
      expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(setup.otpauthUri).toContain('Local%20B'); // issuer
      expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe('verifyTwoFactorToken', () => {
    it('acepta un código TOTP válido generado desde el secreto', () => {
      const secret = authenticator.generateSecret();
      const encryptedSecret = encrypt(secret);
      const token = authenticator.generate(secret);

      expect(verifyTwoFactorToken(encryptedSecret, token)).toBe(true);
    });

    it('rechaza un código inválido', () => {
      const encryptedSecret = encrypt(authenticator.generateSecret());
      expect(verifyTwoFactorToken(encryptedSecret, '000000')).toBe(false);
    });

    it('devuelve false (sin lanzar) si el secreto cifrado está corrupto', () => {
      expect(verifyTwoFactorToken('basura-no-descifrable', '123456')).toBe(false);
    });
  });
});
