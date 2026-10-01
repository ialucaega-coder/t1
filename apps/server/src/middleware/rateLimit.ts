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
 * Cuenta un hit en Redis y devuelve si está permitido. Patrón INCR + PEXPIRE:
 * la primera petición de la ventana crea la clave y le pone TTL; las siguientes
 * solo incrementan. Clave de helper exportada para poder testearla con un
 * cliente mock, sin un Redis real.
 */
export async function redisAllow(client: Redis, key: string, max: number, ttlMs: number): Promise<boolean> {
  const count = await client.incr(key);
  if (count === 1) await client.pexpire(key, ttlMs);
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
