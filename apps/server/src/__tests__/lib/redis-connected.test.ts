/**
 * Pruebas de `lib/redis.ts` CON una REDIS_URL válida, mockeando 'ioredis'.
 * No requiere un Redis real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Registro module-level (hoisted) para que la factory del mock lo alcance.
const h = vi.hoisted(() => ({
  instances: [] as unknown[],
  ctorCalls: [] as Array<{ url: string; opts: Record<string, unknown> }>,
}));

vi.mock('ioredis', async () => {
  const { EventEmitter: EE } = await import('node:events');
  class FakeRedis extends EE {
    status = 'connecting';
    quit = vi.fn(async () => 'OK');
    constructor(url: string, opts: Record<string, unknown>) {
      super();
      h.ctorCalls.push({ url, opts });
      h.instances.push(this);
    }
    duplicate() {
      return new FakeRedis('dup', {});
    }
  }
  return { default: FakeRedis };
});

type FakeInstance = EventEmitter & {
  status: string;
  quit: ReturnType<typeof vi.fn>;
  duplicate: () => FakeInstance;
};

describe('lib/redis · con REDIS_URL válida (ioredis mockeado)', () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    h.instances.length = 0;
    h.ctorCalls.length = 0;
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
    h.instances.length = 0;
    h.ctorCalls.length = 0;
    vi.restoreAllMocks();
  });

  it('isRedisEnabled() es true con REDIS_URL seteada', async () => {
    const m = await import('../../lib/redis');
    expect(m.isRedisEnabled()).toBe(true);
  });

  it('getRedis() es singleton: misma instancia y un solo constructor', async () => {
    const m = await import('../../lib/redis');
    const a = m.getRedis();
    const b = m.getRedis();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(h.ctorCalls).toHaveLength(1);
    expect(h.ctorCalls[0].url).toBe('redis://localhost:6379');
  });

  it('pasa commandTimeout, maxRetriesPerRequest y retryStrategy al constructor', async () => {
    const m = await import('../../lib/redis');
    m.getRedis();
    const opts = h.ctorCalls[0].opts as {
      commandTimeout: number;
      maxRetriesPerRequest: number;
      retryStrategy: (times: number) => number | null;
    };
    expect(opts.commandTimeout).toBe(1000);
    expect(opts.maxRetriesPerRequest).toBe(3);
    expect(typeof opts.retryStrategy).toBe('function');
  });

  it('retryStrategy nunca devuelve null y siempre es <= 5000', async () => {
    const m = await import('../../lib/redis');
    m.getRedis();
    const { retryStrategy } = h.ctorCalls[0].opts as {
      retryStrategy: (times: number) => number | null;
    };
    for (let i = 1; i <= 1000; i++) {
      const delay = retryStrategy(i);
      expect(delay).not.toBeNull();
      expect(typeof delay).toBe('number');
      expect(delay as number).toBeGreaterThan(0);
      expect(delay as number).toBeLessThanOrEqual(5000);
    }
  });

  describe('waitForRedisReady', () => {
    it('resuelve true de inmediato si status === "ready"', async () => {
      const m = await import('../../lib/redis');
      const c = m.getRedis() as unknown as FakeInstance;
      c.status = 'ready';
      await expect(m.waitForRedisReady(30)).resolves.toBe(true);
      expect(c.listenerCount('ready')).toBe(0);
    });

    it('resuelve true cuando se emite "ready" y no deja listeners colgados', async () => {
      const m = await import('../../lib/redis');
      const c = m.getRedis() as unknown as FakeInstance;
      const p = m.waitForRedisReady(1000);
      expect(c.listenerCount('ready')).toBe(1);
      c.emit('ready');
      await expect(p).resolves.toBe(true);
      expect(c.listenerCount('ready')).toBe(0);
    });

    it('resuelve false tras el timeout si nunca llega "ready" y limpia el listener', async () => {
      const m = await import('../../lib/redis');
      const c = m.getRedis() as unknown as FakeInstance;
      const p = m.waitForRedisReady(30);
      expect(c.listenerCount('ready')).toBe(1);
      await expect(p).resolves.toBe(false);
      expect(c.listenerCount('ready')).toBe(0);
    });
  });

  it('closeRedis() llama quit() y luego getRedis() reconstruye el cliente', async () => {
    const m = await import('../../lib/redis');
    const first = m.getRedis() as unknown as FakeInstance;
    expect(h.ctorCalls).toHaveLength(1);

    await m.closeRedis();
    expect(first.quit).toHaveBeenCalledTimes(1);

    const second = m.getRedis();
    expect(h.ctorCalls).toHaveLength(2);
    expect(second).not.toBe(first);
  });
});
