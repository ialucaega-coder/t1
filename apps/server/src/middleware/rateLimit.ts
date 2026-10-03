import { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import { getRedis } from '../lib/redis';

const windowMs = 15 * 60 * 1000;
// Tope de la API general. 100/15min era muy bajo para un dashboard SPA (una
// sesión normal lo supera y empieza a recibir 429). 300/15min da margen sin
// dejar de frenar abuso masivo.
const maxRequests = 300;
const authMaxRequests = 10;

const hits = new Map<string, { count: number; resetAt: number }>();

// La clave incluye un NAMESPACE para que los límites de auth y de API no
// compartan el mismo contador: antes ambos usaban solo la IP, así que ~10
// requests de API bloqueaban el login (y cada request de auth contaba doble,
// porque pasa por el limitador global y por el de /auth).
function getKey(req: Request, namespace: string): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${namespace}:${ip}`;
}

const TOO_MANY = { error: 'Too many requests. Try again later.' };

/**
 * Rate limiting in-memory (síncrono). Es el fallback para despliegues de una
 * sola instancia. El conteo vive en el proceso, por eso no sirve si hay varias
 * réplicas detrás de un balanceador (para eso está el modo Redis).
 */
function inMemoryRateLimit(max: number, namespace: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') return next();

    const key = getKey(req, namespace);
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
function redisRateLimit(max: number, namespace: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'development') return next();

    const client = getRedis();
    if (!client) return next(); // REDIS_URL se quitó en caliente: no bloqueamos.

    try {
      const allowed = await redisAllow(client, `rl:${getKey(req, namespace)}`, max, windowMs);
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
export function rateLimit(max = maxRequests, namespace = 'api') {
  return getRedis() ? redisRateLimit(max, namespace) : inMemoryRateLimit(max, namespace);
}

// Buckets separados: 'auth' (login/register, estricto) y 'api' (resto). Así un
// uso normal de la API no consume el cupo de autenticación ni al revés.
export const authRateLimit = rateLimit(authMaxRequests, 'auth');
export const apiRateLimit = rateLimit(maxRequests, 'api');

// Limpieza periódica del mapa in-memory (no aplica al modo Redis, que usa TTL).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key);
  }
}, 60_000).unref?.();
