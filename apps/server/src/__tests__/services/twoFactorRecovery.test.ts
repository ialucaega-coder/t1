/**
 * Pruebas de las partes puras de los códigos de recuperación del 2FA
 * (`services/auth/twoFactorRecovery.ts`). La persistencia y el consumo de un solo
 * uso se cubren de punta a punta en routes/auth-2fa.test.ts. Prisma se mockea
 * solo porque el módulo lo importa.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));

import { normalizeRecoveryCode, RECOVERY_CODE_COUNT } from '../../services/auth/twoFactorRecovery';

describe('services/auth/twoFactorRecovery — normalizeRecoveryCode', () => {
  it('acepta mayúsculas, minúsculas, con o sin guion y con espacios', () => {
    expect(normalizeRecoveryCode('K7M2P-X9QDA')).toBe('K7M2PX9QDA');
    expect(normalizeRecoveryCode('k7m2p-x9qda')).toBe('K7M2PX9QDA');
    expect(normalizeRecoveryCode(' K7M2P X9QDA ')).toBe('K7M2PX9QDA');
    expect(normalizeRecoveryCode('K7M2PX9QDA')).toBe('K7M2PX9QDA');
  });

  it('rechaza largos incorrectos y caracteres fuera del alfabeto (0, O, 1, I, L, U)', () => {
    expect(normalizeRecoveryCode('K7M2P')).toBeNull();
    expect(normalizeRecoveryCode('K7M2P-X9QDAA')).toBeNull();
    expect(normalizeRecoveryCode('K7M2P-X9QD0')).toBeNull();
    expect(normalizeRecoveryCode('K7M2P-X9QDL')).toBeNull();
    expect(normalizeRecoveryCode('')).toBeNull();
  });

  it('un código TOTP de 6 dígitos no se confunde con uno de recuperación', () => {
    expect(normalizeRecoveryCode('123456')).toBeNull();
  });

  it('emite 10 códigos por juego', () => {
    expect(RECOVERY_CODE_COUNT).toBe(10);
  });
});
