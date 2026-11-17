/**
 * Pruebas del rate limiting distribuido con Redis (`redisAllow`), con un cliente
 * mock (sin Redis real). El conteo es atómico vía un script Lua (INCR + PEXPIRE
 * en una sola operación), así que el fake simula `eval` con la misma semántica:
 * mantiene contador y TTL por clave, incrementa, y setea el TTL en la primera
 * petición o si la clave quedó huérfana (PTTL == -1).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { redisAllow } from '../../middleware/rateLimit';

/** Cliente Redis mínimo simulado: implementa `eval` con la lógica del script. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>(); // -1 = sin TTL (huérfana)

  const evalFn = vi.fn(async (_script: string, _numKeys: number, key: string, ttlArg: string) => {
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (c === 1 || (ttls.get(key) ?? -1) === -1) {
      ttls.set(key, Number(ttlArg));
    }
    return c;
  });

  return {
    client: { eval: evalFn } as unknown as Redis,
    evalFn,
    // Helpers para los tests.
    orphan: (key: string, count: number) => { counts.set(key, count); ttls.set(key, -1); },
    ttlOf: (key: string) => ttls.get(key) ?? -1,
  };
}

describe('middleware/rateLimit · redisAllow (Lua atómico)', () => {
  it('permite mientras no se supera el máximo y setea TTL en la primera', async () => {
    const r = fakeRedis();

    expect(await redisAllow(r.client, 'rl:1.1.1.1', 2, 1000)).toBe(true); // count 1
    expect(await redisAllow(r.client, 'rl:1.1.1.1', 2, 1000)).toBe(true); // count 2
    expect(await redisAllow(r.client, 'rl:1.1.1.1', 2, 1000)).toBe(false); // count 3 > 2

    expect(r.ttlOf('rl:1.1.1.1')).toBe(1000);
    // El script corre una vez por petición.
    expect(r.evalFn).toHaveBeenCalledTimes(3);
  });

  it('cuenta de forma independiente por clave (IP)', async () => {
    const r = fakeRedis();
    expect(await redisAllow(r.client, 'rl:a', 1, 1000)).toBe(true);
    expect(await redisAllow(r.client, 'rl:a', 1, 1000)).toBe(false); // a excedió
    expect(await redisAllow(r.client, 'rl:b', 1, 1000)).toBe(true); // b es independiente
  });

  it('auto-repara una clave huérfana que quedó sin TTL', async () => {
    const r = fakeRedis();
    r.orphan('rl:huerfana', 5); // clave con count 5 y sin TTL (-1)

    await redisAllow(r.client, 'rl:huerfana', 100, 1000);

    // La próxima llamada le vuelve a poner el TTL (evita bloqueo permanente).
    expect(r.ttlOf('rl:huerfana')).toBe(1000);
  });
});
