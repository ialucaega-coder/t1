/**
 * Pruebas del hashing de contraseñas (`lib/password.ts`): Argon2id para hashes
 * nuevos y backward-compat con bcrypt (verificación + señal de rehash perezoso).
 * Usa las implementaciones reales de argon2 y bcrypt (sin mocks).
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, equalizeVerifyTiming } from '../../lib/password';

describe('lib/password', () => {
  it('hashPassword produce un hash Argon2id verificable', async () => {
    const h = await hashPassword('secreto-fuerte');
    expect(h.startsWith('$argon2id$')).toBe(true);
    const { valid, needsRehash } = await verifyPassword('secreto-fuerte', h);
    expect(valid).toBe(true);
    expect(needsRehash).toBe(false); // ya es argon2, no hay que rehashear
  });

  it('rechaza una contraseña incorrecta contra un hash Argon2id', async () => {
    const h = await hashPassword('correcta');
    const { valid } = await verifyPassword('incorrecta', h);
    expect(valid).toBe(false);
  });

  it('valida un hash bcrypt legado y marca needsRehash', async () => {
    const legacy = await bcrypt.hash('clave-vieja', 10);
    const { valid, needsRehash } = await verifyPassword('clave-vieja', legacy);
    expect(valid).toBe(true);
    expect(needsRehash).toBe(true); // bcrypt → conviene reescribir a Argon2id
  });

  it('una contraseña incorrecta contra bcrypt no marca rehash', async () => {
    const legacy = await bcrypt.hash('clave-vieja', 10);
    const { valid, needsRehash } = await verifyPassword('otra', legacy);
    expect(valid).toBe(false);
    expect(needsRehash).toBe(false);
  });

  it('nunca valida contra hashes vacíos o de formato desconocido', async () => {
    for (const stored of ['', 'telegram-no-password', 'plano', null, undefined]) {
      const { valid, needsRehash } = await verifyPassword('x', stored);
      expect(valid).toBe(false);
      expect(needsRehash).toBe(false);
    }
  });

  it('no lanza con un hash bcrypt corrupto (cumple el contrato "nunca lanza")', async () => {
    const corrupt = '$2b$roto';
    const { valid, needsRehash } = await verifyPassword('x', corrupt);
    expect(valid).toBe(false);
    expect(needsRehash).toBe(false);
  });

  it('equalizeVerifyTiming resuelve sin lanzar', async () => {
    await expect(equalizeVerifyTiming()).resolves.toBeUndefined();
  });
});
