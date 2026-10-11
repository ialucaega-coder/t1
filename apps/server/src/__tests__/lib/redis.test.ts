/**
 * Pruebas del cliente Redis opcional (`lib/redis.ts`) en modo single-node:
 * sin REDIS_URL, el sistema NO abre conexión y degrada a fallbacks in-memory.
 * No requiere un Redis real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('lib/redis · fallback single-node (sin REDIS_URL)', () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
    vi.resetModules(); // re-evalúa el singleton con el env actual
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it('isRedisEnabled() es false y getRedis() devuelve null', async () => {
    const { isRedisEnabled, getRedis } = await import('../../lib/redis');
    expect(isRedisEnabled()).toBe(false);
    expect(getRedis()).toBeNull();
  });

  it('waitForRedisReady() resuelve false sin colgar', async () => {
    const { waitForRedisReady } = await import('../../lib/redis');
    await expect(waitForRedisReady(50)).resolves.toBe(false);
  });

  it('una REDIS_URL con esquema inválido degrada a in-memory (no lanza)', async () => {
    process.env.REDIS_URL = 'http://no-es-redis:6379';
    vi.resetModules();
    const { getRedis } = await import('../../lib/redis');
    expect(getRedis()).toBeNull();
  });
});
