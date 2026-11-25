/**
 * Pruebas de `lib/sharedState`: con Redis usa el cliente compartido; sin Redis (o
 * si Redis falla en una llamada) degrada a memoria sin lanzar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisRef: { current: unknown } = { current: null };
vi.mock('../../lib/redis', () => ({ getRedis: () => redisRef.current }));

import { sharedIncr, sharedGet, sharedSet, sharedDel, sharedTryLock } from '../../lib/sharedState';
import { cache } from '../../lib/cache';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    eval: vi.fn(async (_s: string, _n: number, key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ..._args: unknown[]) => {
      if (_args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
  };
}

beforeEach(() => {
  cache.clear();
  redisRef.current = null;
});

describe('lib/sharedState — sin Redis (memoria)', () => {
  it('sharedIncr cuenta de 1 en 1', async () => {
    expect(await sharedIncr('k', 1000)).toBe(1);
    expect(await sharedIncr('k', 1000)).toBe(2);
  });

  it('get/set/del de JSON', async () => {
    await sharedSet('s', { step: 'a', n: 1 }, 1000);
    expect(await sharedGet('s')).toEqual({ step: 'a', n: 1 });
    await sharedDel('s');
    expect(await sharedGet('s')).toBeUndefined();
  });

  it('sharedTryLock: el primero lo obtiene, el segundo no', async () => {
    expect(await sharedTryLock('job', 1000)).toBe(true);
    expect(await sharedTryLock('job', 1000)).toBe(false);
  });
});

describe('lib/sharedState — con Redis', () => {
  it('usa Redis (y no la memoria local) para contar y guardar', async () => {
    const r = fakeRedis();
    redisRef.current = r;

    expect(await sharedIncr('biz:chat', 5000)).toBe(1);
    expect(await sharedIncr('biz:chat', 5000)).toBe(2);
    expect(r.eval).toHaveBeenCalledTimes(2);

    await sharedSet('tg:1', { step: 'x' }, 5000);
    expect(r.store.get('ss:tg:1')).toBe(JSON.stringify({ step: 'x' }));
    expect(await sharedGet('tg:1')).toEqual({ step: 'x' });
    await sharedDel('tg:1');
    expect(await sharedGet('tg:1')).toBeUndefined();
  });

  it('dos "instancias" comparten el contador (mismo Redis)', async () => {
    const r = fakeRedis();
    redisRef.current = r;
    await sharedIncr('quota', 5000); // instancia A
    expect(await sharedIncr('quota', 5000)).toBe(2); // instancia B ve el mismo total
  });

  it('sharedTryLock: solo una instancia toma el lock', async () => {
    redisRef.current = fakeRedis();
    expect(await sharedTryLock('cron:daily', 5000)).toBe(true);
    expect(await sharedTryLock('cron:daily', 5000)).toBe(false);
  });

  it('si Redis falla, degrada a memoria sin lanzar', async () => {
    const r = fakeRedis();
    r.eval.mockRejectedValue(new Error('down'));
    r.get.mockRejectedValue(new Error('down'));
    r.set.mockRejectedValue(new Error('down'));
    redisRef.current = r;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sharedIncr('k', 1000)).toBe(1);
    await sharedSet('v', 7, 1000);
    expect(await sharedGet('v')).toBe(7);
    // El lock con Redis caído es fail-open: el job corre antes que no correr.
    expect(await sharedTryLock('job', 1000)).toBe(true);
  });
});

describe('lib/sharedState — sharedIncr sin Redis usa ventana FIJA', () => {
  it('el contador vence a los ttl del primer incremento aunque se siga incrementando (no se extiende)', async () => {
    vi.useFakeTimers();
    try {
      // Un poller legítimo: 1 hit cada 4 s durante 70 s con ventana de 60 s.
      const counts: number[] = [];
      for (let t = 0; t <= 68_000; t += 4_000) {
        vi.setSystemTime(new Date(1_700_000_000_000 + t));
        counts.push(await sharedIncr('poll', 60_000));
      }
      // Antes (TTL deslizante) el contador no vencía nunca y seguía creciendo.
      const resetIdx = counts.findIndex((c, i) => i > 0 && c === 1);
      expect(resetIdx).toBeGreaterThan(0);
      expect(counts[resetIdx - 1]).toBeLessThanOrEqual(16); // ~15 hits por ventana
      expect(Math.max(...counts)).toBeLessThan(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sharedGet sigue leyendo el contador como número', async () => {
    await sharedIncr('c', 1000);
    await sharedIncr('c', 1000);
    expect(await sharedGet<number>('c')).toBe(2);
  });
});
