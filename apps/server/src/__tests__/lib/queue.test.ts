/**
 * Pruebas de `lib/queue`: inline sin Redis (con dedupe por jobId), encolado real
 * con BullMQ mockeado, y fallback inline cuando Redis falla al encolar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Added {
  name: string;
  data: unknown;
  opts: Record<string, unknown>;
}
interface Rec {
  added: Added[];
  workers: Array<{ name: string; concurrency: number }>;
  failAdd: boolean;
}
const rec = (): Rec => (globalThis as unknown as { __q: Rec }).__q;

vi.mock('bullmq', () => {
  const state: Rec = ((globalThis as unknown as { __q?: Rec }).__q ??= { added: [], workers: [], failAdd: false });
  class Queue {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    async add(name: string, data: unknown, opts: Record<string, unknown>) {
      if (state.failAdd) throw new Error('redis down');
      state.added.push({ name, data, opts });
    }
    async close() {}
  }
  class Worker {
    constructor(name: string, _fn: unknown, opts: { concurrency: number }) {
      state.workers.push({ name, concurrency: opts.concurrency });
    }
    on() {
      return this;
    }
    async close() {}
  }
  return { Queue, Worker };
});
vi.mock('ioredis', () => {
  class IORedis {
    on() {
      return this;
    }
    async quit() {}
  }
  return { default: IORedis };
});

import { defineQueue, enqueue, startWorkers, closeQueues } from '../../lib/queue';
import { cache } from '../../lib/cache';

const OLD_ENV = { ...process.env };

beforeEach(async () => {
  cache.clear();
  await closeQueues();
  rec().added.length = 0;
  rec().workers.length = 0;
  rec().failAdd = false;
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('lib/queue — inline (sin Redis)', () => {
  beforeEach(() => {
    process.env.QUEUES_DISABLED = 'true';
  });

  it('ejecuta el handler en el acto y espera a que termine', async () => {
    const seen: unknown[] = [];
    defineQueue<{ n: number }>('q-inline-1', async (d) => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(d.n);
    });
    expect(await enqueue('q-inline-1', { n: 1 })).toBe('inline');
    expect(seen).toEqual([1]); // ya terminó cuando enqueue devuelve
  });

  it('dedupe por jobId: el segundo con el mismo id no se ejecuta', async () => {
    let runs = 0;
    defineQueue('q-inline-2', async () => {
      runs++;
    });
    expect(await enqueue('q-inline-2', {}, { jobId: 'wa_SM1' })).toBe('inline');
    expect(await enqueue('q-inline-2', {}, { jobId: 'wa_SM1' })).toBe('duplicate');
    expect(await enqueue('q-inline-2', {}, { jobId: 'wa_SM2' })).toBe('inline');
    expect(runs).toBe(2);
  });

  it('un handler que falla no propaga el error al caller', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defineQueue('q-inline-3', async () => {
      throw new Error('boom');
    });
    await expect(enqueue('q-inline-3', {})).resolves.toBe('inline');
    err.mockRestore();
  });
});

describe('lib/queue — con Redis (BullMQ)', () => {
  beforeEach(() => {
    delete process.env.QUEUES_DISABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('encola con el jobId y NO ejecuta el handler en el request', async () => {
    let runs = 0;
    defineQueue('q-redis-1', async () => {
      runs++;
    });
    expect(await enqueue('q-redis-1', { x: 1 }, { jobId: 'wa_SM9' })).toBe('queued');
    expect(runs).toBe(0);
    expect(rec().added).toHaveLength(1);
    expect(rec().added[0].opts).toMatchObject({ jobId: 'wa_SM9' });
  });

  it('con attempts>1 configura backoff exponencial', async () => {
    defineQueue('q-redis-2', async () => undefined);
    await enqueue('q-redis-2', {}, { attempts: 3, backoffMs: 500 });
    expect(rec().added[0].opts).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 500 } });
  });

  it('si Redis falla al encolar, ejecuta inline (no pierde el trabajo)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let runs = 0;
    defineQueue('q-redis-3', async () => {
      runs++;
    });
    rec().failAdd = true;
    expect(await enqueue('q-redis-3', {})).toBe('inline');
    expect(runs).toBe(1);
    err.mockRestore();
  });

  it('startWorkers crea un worker por cola con su concurrencia; RUN_WORKERS=false no', async () => {
    defineQueue('q-redis-4', async () => undefined, { concurrency: 7 });
    process.env.RUN_WORKERS = 'false';
    startWorkers();
    expect(rec().workers).toHaveLength(0);

    delete process.env.RUN_WORKERS;
    startWorkers();
    expect(rec().workers.find((w) => w.name === 'q-redis-4')).toEqual({ name: 'q-redis-4', concurrency: 7 });
  });
});
