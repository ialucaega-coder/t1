import type { Request, Response, NextFunction } from 'express';
import { sharedIncr } from '../lib/sharedState';

interface TenantRateLimitOptions {
  /** Nombre del bucket (separa los contadores entre endpoints). */
  name: string;
  /** Máximo de llamadas por ventana y por negocio. */
  max: number;
  /** Ventana en ms (default 1 min). */
  windowMs?: number;
}

/**
 * Tope de llamadas por NEGOCIO (no por IP) para endpoints que gastan LLM.
 *
 * El rate limit global es por IP y generoso (300/15 min): no frena a un tenant
 * que dispara muchas corridas de IA desde varias IPs, ni protege el costo de la
 * plataforma (p. ej. `/mrgo/run` hace hasta 11 llamadas al modelo por request).
 * El contador es compartido entre instancias (Redis, ver lib/sharedState) y la
 * ventana es fija. Debe ir DESPUÉS de `requireAuth`.
 *
 * Se omite en NODE_ENV=test salvo TENANT_RL_FORCE=true (así los tests de rutas
 * no dependen del contador; el middleware tiene sus propios tests).
 */
export function tenantRateLimit({ name, max, windowMs = 60_000 }: TenantRateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const businessId = req.auth?.businessId;
    if (!businessId || (process.env.NODE_ENV === 'test' && process.env.TENANT_RL_FORCE !== 'true')) {
      next();
      return;
    }
    const window = Math.floor(Date.now() / windowMs);
    const count = await sharedIncr(`trl:${name}:${businessId}:${window}`, windowMs);
    if (count > max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: 'Demasiadas solicitudes de IA en poco tiempo. Esperá un momento e intentá de nuevo.' });
      return;
    }
    next();
  };
}
