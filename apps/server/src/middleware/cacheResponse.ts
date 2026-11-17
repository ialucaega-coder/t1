import type { Request, Response, NextFunction } from 'express';
import { cache, cacheKey } from '../lib/cache';

/** Largo máximo de la URL (path+query) que se cachea: acota las claves distintas. */
const MAX_CACHED_URL_LEN = 200;

/**
 * Cachea unos segundos la respuesta JSON 200 de un GET, por negocio + URL.
 *
 * Pensado para los endpoints de agregación del dashboard (analytics), que
 * recorren muchas filas y son idénticos entre recargas/pestañas. Debe ir DESPUÉS
 * de `requireAuth` (la clave lleva el `businessId`, así que un tenant nunca ve la
 * respuesta de otro). Solo se guardan respuestas 200; los errores no se cachean.
 *
 * Es por instancia (ver `lib/cache`): con N instancias cada una calcula una vez
 * por TTL, que igual divide la carga por la cantidad de requests en la ventana.
 */
export function cacheResponse(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const businessId = req.auth?.businessId;
    if (!businessId || req.method !== 'GET' || req.originalUrl.length > MAX_CACHED_URL_LEN) {
      next();
      return;
    }
    const key = cacheKey(businessId, 'resp', req.originalUrl);
    const hit = cache.get<unknown>(key);
    if (hit !== undefined) {
      res.json(hit);
      return;
    }
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode === 200) cache.set(key, body, ttlMs);
      return originalJson(body);
    };
    next();
  };
}
