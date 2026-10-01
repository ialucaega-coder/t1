import { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import { getRedis } from '../lib/redis';

const windowMs = 15 * 60 * 1000;
const maxRequests = 100;
const authMaxRequests = 10;

const hits = new Map<string, { count: number; resetAt: number }>();

function getKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

const TOO_MANY = { error: 'Too many requests. Try again later.' };

/**
 * Rate limiting in-memory (síncrono). Es el fallback para despliegues de una
 * sola instancia. El conteo vive en el proceso, por eso no sirve si hay varias
 * réplicas detrás de un balanceador (para eso está el modo Redis).
 */
function inMemoryRateLimit(max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') return next();

    const key = getKey(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      res.status(429).json(TOO_MANY);
      return;
    }
    next();
  };
}

/**
 * Script Lua ATÓMICO: incrementa el contador y le pone TTL en una sola
 * operación server-side. Hacer INCR y PEXPIRE por separado no es atómico —
 * si el proceso muere (o PEXPIRE falla) entre ambos, la clave queda SIN TTL y
 * esa IP recibe 429 para siempre. El script además auto-repara claves
 * huérfanas: si por lo que sea el TTL quedó en -1, lo vuelve a setear.
 */
const RATE_LIMIT_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('PTTL', KEYS[1]) == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return c`;

/**
 * Cuenta un hit en Redis (de forma atómica) y devuelve si está permitido.
 * Helper exportado para poder testearlo con un cliente mock, sin un Redis real.
 */
export async function redisAllow(client: Redis, key: string, max: number, ttlMs: number): Promise<boolean> {
  const count = Number(await client.eval(RATE_LIMIT_LUA, 1, key, String(ttlMs)));
  return count <= max;
}

/**
 * Rate limiting distribuido con Redis (compartido entre instancias). Si Redis
 * falla, degrada FAIL-OPEN (permite la petición) para no tumbar la API por un
 * problema de infraestructura del limitador.
 */
function redisRateLimit(max: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') return next();

    const client = getRedis();
    if (!client) return next(); // REDIS_URL se quitó en caliente: no bloqueamos.

    try {
      const allowed = await redisAllow(client, `rl:${getKey(req)}`, max, windowMs);
      if (!allowed) {
        res.status(429).json(TOO_MANY);
        return;
      }
      next();
    } catch (err) {
      console.error('[rateLimit] Redis no disponible; se permite la petición:', (err as Error).message);
      next();
    }
  };
}

/**
 * Construye el middleware de rate limiting. Usa Redis si REDIS_URL está
 * configurada (escalado multi-instancia), o el fallback in-memory si no.
 */
export function rateLimit(max = maxRequests) {
  return getRedis() ? redisRateLimit(max) : inMemoryRateLimit(max);
}

export const authRateLimit = rateLimit(authMaxRequests);
export const apiRateLimit = rateLimit(maxRequests);

// Limpieza periódica del mapa in-memory (no aplica al modo Redis, que usa TTL).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key);
  }
}, 60_000).unref?.();
