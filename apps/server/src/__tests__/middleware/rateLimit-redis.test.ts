/**
 * Pruebas del rate limiting distribuido con Redis (`redisAllow`), con un cliente
 * mock (sin Redis real). Verifica el patrón INCR + PEXPIRE: la primera petición
 * de la ventana pone el TTL, y se bloquea al superar el máximo.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { redisAllow } from '../../middleware/rateLimit';

/** Cliente Redis mínimo simulado: un contador en memoria con INCR/PEXPIRE. */
function fakeRedis() {
  const store = new Map<string, number>();
  const incr = vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  });
  const pexpire = vi.fn(async () => 1);
  return { client: { incr, pexpire } as unknown as Redis, incr, pexpire };
}

describe('middleware/rateLimit · redisAllow', () => {
  it('permite mientras no se supera el máximo y setea TTL en la primera', async () => {
    const { client, pexpire } = fakeRedis();

    expect(await redisAllow(client, 'rl:1.1.1.1', 2, 1000)).toBe(true); // count 1
    expect(await redisAllow(client, 'rl:1.1.1.1', 2, 1000)).toBe(true); // count 2
    expect(await redisAllow(client, 'rl:1.1.1.1', 2, 1000)).toBe(false); // count 3 > 2

    // El TTL solo se setea en la primera petición de la ventana.
    expect(pexpire).toHaveBeenCalledTimes(1);
    expect(pexpire).toHaveBeenCalledWith('rl:1.1.1.1', 1000);
  });

  it('cuenta de forma independiente por clave (IP)', async () => {
    const { client } = fakeRedis();
    expect(await redisAllow(client, 'rl:a', 1, 1000)).toBe(true);
    expect(await redisAllow(client, 'rl:a', 1, 1000)).toBe(false); // a excedió
    expect(await redisAllow(client, 'rl:b', 1, 1000)).toBe(true); // b es independiente
  });
});
