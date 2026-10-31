/**
 * Estado compartido entre instancias, con fallback en memoria.
 *
 * Con REDIS_URL el estado vive en Redis y lo ven todas las réplicas; sin Redis
 * (una sola instancia) usa la caché en memoria del proceso. Si Redis falla en
 * una llamada, ESA llamada degrada a memoria (best-effort, se loguea): el
 * estado que se guarda acá (contadores de abuso, flujos de conversación
 * efímeros, locks de jobs) nunca debe tumbar el request que lo consulta.
 *
 * Multi-tenant: las claves las arma el caller e incluyen el `businessId`.
 */
import { cache } from './cache';
import { getRedis } from './redis';

const PREFIX = 'ss:';

/** Incremento atómico + TTL en una sola operación (ver rateLimit.ts: mismo motivo). */
const INCR_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('PTTL', KEYS[1]) == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return c`;

let warned = false;
function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.error('[sharedState] Redis no disponible; se usa memoria local:', (err as Error).message);
}

/** Suma 1 a un contador con TTL (la ventana arranca en el primer incremento) y devuelve el total. */
export async function sharedIncr(key: string, ttlMs: number): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      return Number(await redis.eval(INCR_LUA, 1, PREFIX + key, String(ttlMs)));
    } catch (err) {
      warnOnce(err);
    }
  }
  // `cache` no expone el vencimiento, así que cada incremento renueva el TTL: el
  // fallback es best-effort (una sola instancia) y una ventana algo más larga es
  // aceptable.
  const next = (cache.get<number>(PREFIX + key) ?? 0) + 1;
  cache.set(PREFIX + key, next, ttlMs);
  return next;
}

/** Lee un valor JSON (o undefined si no existe/venció). */
export async function sharedGet<T>(key: string): Promise<T | undefined> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(PREFIX + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      warnOnce(err);
    }
  }
  return cache.get<T>(PREFIX + key);
}

/** Guarda un valor JSON con TTL. */
export async function sharedSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(PREFIX + key, JSON.stringify(value), 'PX', ttlMs);
      return;
    } catch (err) {
      warnOnce(err);
    }
  }
  cache.set(PREFIX + key, value, ttlMs);
}

/** Borra una clave. */
export async function sharedDel(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(PREFIX + key);
      return;
    } catch (err) {
      warnOnce(err);
    }
  }
  cache.del(PREFIX + key);
}

/**
 * Intenta tomar un lock con TTL (SET NX PX). Devuelve true si lo obtuvo. Sirve
 * para que, de N instancias, solo UNA corra un job/slot. Sin Redis (una sola
 * instancia) siempre lo obtiene salvo que ya esté tomado en este proceso.
 * Si Redis falla devuelve true (fail-open): es mejor que un job corra de más
 * que dejar de correr, y los jobs que lo usan son idempotentes por diseño.
 */
export async function sharedTryLock(key: string, ttlMs: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const res = await redis.set(PREFIX + 'lock:' + key, '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch (err) {
      warnOnce(err);
      return true;
    }
  }
  if (cache.get<number>(PREFIX + 'lock:' + key)) return false;
  cache.set(PREFIX + 'lock:' + key, 1, ttlMs);
  return true;
}
