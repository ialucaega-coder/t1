/**
 * Colas de trabajo en segundo plano (BullMQ sobre el Redis existente).
 *
 * Para qué: sacar del request HTTP el trabajo lento o que no debe perderse (LLM,
 * envíos por WhatsApp, automatizaciones) y poder deduplicar por `jobId`
 * (p. ej. el MessageSid de Twilio: un reintento del proveedor no duplica el
 * mensaje ni el costo de IA).
 *
 * Modos:
 *  - Con REDIS_URL: `enqueue` encola y un Worker (en este u otro proceso) lo
 *    ejecuta. El dedupe por `jobId` vale mientras BullMQ retiene el job (1 h).
 *  - Sin Redis (una sola instancia/desarrollo): `enqueue` EJECUTA el handler en
 *    el acto y espera a que termine, o sea el mismo comportamiento que antes de
 *    las colas (el webhook responde cuando termina). El dedupe usa un lock en
 *    memoria (sharedState).
 *  - Si Redis falla al encolar: se ejecuta inline (fail-open) para no perder el
 *    mensaje.
 *
 * Workers: cada proceso registra los handlers (`defineQueue`) al importar sus
 * módulos y `startWorkers()` levanta los consumidores. `RUN_WORKERS=false` deja
 * una instancia solo como productora (p. ej. las que atienden tráfico web).
 *
 * Los datos del job viajan por Redis: NUNCA poner secretos (tokens, API keys);
 * el handler los vuelve a leer de la DB con el `businessId`.
 */
import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { sharedTryLock } from './sharedState';

export type QueueHandler<T> = (data: T) => Promise<void>;

export interface EnqueueOptions {
  /** Id único del trabajo: encolar dos veces el mismo id lo ejecuta una sola vez. */
  jobId?: string;
  /** Intentos totales (default 1: los handlers de webhooks no son idempotentes). */
  attempts?: number;
  /** Espera base (ms) del backoff exponencial entre intentos. */
  backoffMs?: number;
  /** Demora (ms) antes de ejecutar. */
  delayMs?: number;
}

export type EnqueueResult = 'queued' | 'inline' | 'duplicate';

interface QueueDef {
  handler: QueueHandler<never>;
  concurrency: number;
}

const defs = new Map<string, QueueDef>();
const queues = new Map<string, Queue>();
const workers: Worker[] = [];
let connection: IORedis | null = null;
let workersStarted = false;

/** Ventana de dedupe en modo inline (sin Redis). */
const INLINE_DEDUPE_MS = 10 * 60 * 1000;

/** ¿Hay colas reales (Redis)? Sin REDIS_URL todo corre inline. */
export function queuesEnabled(): boolean {
  return Boolean(process.env.REDIS_URL) && process.env.QUEUES_DISABLED !== 'true';
}

function getConnection(): IORedis {
  if (!connection) {
    // BullMQ exige maxRetriesPerRequest:null en las conexiones de Workers (usan
    // comandos bloqueantes). Es una conexión propia, aparte de la de lib/redis.
    connection = new IORedis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    connection.on('error', (err) => console.error('[queue] error de conexión Redis:', err.message));
  }
  return connection;
}

function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        // Retención: el dedupe por jobId vale mientras el job siga retenido.
        removeOnComplete: { age: 60 * 60, count: 5000 },
        removeOnFail: { age: 24 * 60 * 60, count: 5000 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

/**
 * Registra el handler de una cola. Idempotente por nombre. Llamar al cargar el
 * módulo dueño del trabajo (así todo proceso sabe ejecutarlo, sea inline o worker).
 */
export function defineQueue<T>(name: string, handler: QueueHandler<T>, opts: { concurrency?: number } = {}): void {
  defs.set(name, { handler: handler as QueueHandler<never>, concurrency: opts.concurrency ?? 5 });
}

async function runInline(name: string, data: unknown, opts: EnqueueOptions): Promise<EnqueueResult> {
  if (opts.jobId && !(await sharedTryLock(`job:${name}:${opts.jobId}`, INLINE_DEDUPE_MS))) {
    return 'duplicate';
  }
  const def = defs.get(name);
  if (!def) {
    console.error(`[queue] cola sin handler: ${name}`);
    return 'inline';
  }
  // Inline también respeta `attempts` (con backoff exponencial): sin Redis no hay
  // worker que reintente, y un trabajo que se retoma solo (p. ej. campañas) lo necesita.
  const attempts = Math.max(1, opts.attempts ?? 1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await (def.handler as QueueHandler<unknown>)(data);
      break;
    } catch (err) {
      // Igual que un job fallido: no se propaga al caller (webhooks y fire-and-forget).
      console.error(`[queue] ${name} falló (inline, intento ${attempt}/${attempts}):`, (err as Error).message);
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, Math.min((opts.backoffMs ?? 2000) * 2 ** (attempt - 1), 30_000)));
      }
    }
  }
  return 'inline';
}

/**
 * Encola un trabajo (o lo ejecuta inline si no hay Redis / falla). Nunca lanza.
 */
export async function enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}): Promise<EnqueueResult> {
  if (!queuesEnabled()) return runInline(name, data, opts);

  try {
    const jobOpts: JobsOptions = {
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
      ...(opts.attempts && opts.attempts > 1
        ? { attempts: opts.attempts, backoff: { type: 'exponential', delay: opts.backoffMs ?? 2000 } }
        : {}),
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    };
    await getQueue(name).add(name, data, jobOpts);
    return 'queued';
  } catch (err) {
    // Redis caído: ejecutamos inline antes que perder el trabajo.
    console.error(`[queue] no se pudo encolar ${name}; se ejecuta inline:`, (err as Error).message);
    return runInline(name, data, opts);
  }
}

/**
 * Levanta los consumidores de todas las colas definidas. No hace nada sin Redis,
 * si ya se llamó, o con RUN_WORKERS=false. Llamar una vez al arrancar el server.
 */
export function startWorkers(): void {
  if (workersStarted || !queuesEnabled()) return;
  if (process.env.RUN_WORKERS === 'false') {
    console.log('[queue] Workers deshabilitados por RUN_WORKERS=false (esta instancia solo encola)');
    return;
  }
  workersStarted = true;

  for (const [name, def] of defs) {
    const worker = new Worker(
      name,
      async (job) => {
        await (def.handler as QueueHandler<unknown>)(job.data);
      },
      { connection: getConnection(), concurrency: def.concurrency },
    );
    worker.on('failed', (job, err) => {
      console.error(`[queue] ${name} ${job?.id ?? ''} falló:`, err.message);
    });
    worker.on('error', (err) => console.error(`[queue] worker ${name}:`, err.message));
    workers.push(worker);
  }
  console.log(`[queue] Workers activos: ${[...defs.keys()].join(', ') || '(ninguno)'}`);
}

/** Apagado limpio: deja terminar los jobs en vuelo y cierra las conexiones. */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  workers.length = 0;
  queues.clear();
  workersStarted = false;
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
