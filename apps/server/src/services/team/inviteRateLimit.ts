/**
 * Rate limits del flujo de invitaciones. Contador compartido entre instancias
 * (Redis vía lib/sharedState) con fallback en memoria, ventana fija.
 *
 *  - `inviteRateLimit`: por NEGOCIO (no por IP) para invitar/reenviar. Cada envío
 *    manda un mail a un tercero, así que un admin (o una sesión robada) no puede
 *    usarlo como cañón de spam: 20 envíos por hora y negocio.
 *  - `acceptInviteRateLimit`: por IP para el canje público. Más estricto que el
 *    de login: un invitado legítimo canjea UNA vez.
 *
 * DEPLOY (importante): el límite por IP de `acceptInviteRateLimit` usa `req.ip`. Detrás de
 * un proxy / balanceador solo es correcto con TRUST_PROXY_HOPS bien configurado (si no,
 * todos los invitados comparten la IP del proxy, o un atacante falsea X-Forwarded-For).
 * Y los contadores solo se comparten entre réplicas con REDIS_URL; sin Redis cada
 * instancia cuenta por su cuenta y el tope efectivo es max x cantidad de instancias.
 *
 * Igual que `tenantRateLimit`, se omiten en NODE_ENV=test salvo
 * TENANT_RL_FORCE=true (los tests de rutas no dependen del contador; el límite
 * tiene sus propios tests) y en desarrollo local para no trabar las pruebas a mano.
 */
import type { NextFunction, Request, Response } from 'express';
import { sharedIncr } from '../../lib/sharedState';

interface Options {
  name: string;
  max: number;
  windowMs: number;
  message: string;
}

function skip(): boolean {
  if (process.env.NODE_ENV === 'test') return process.env.TENANT_RL_FORCE !== 'true';
  return process.env.NODE_ENV === 'development';
}

function build(keyOf: (req: Request) => string | undefined, { name, max, windowMs, message }: Options) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const id = keyOf(req);
    if (!id || skip()) {
      next();
      return;
    }
    const window = Math.floor(Date.now() / windowMs);
    const count = await sharedIncr(`${name}:${id}:${window}`, windowMs);
    if (count > max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}

/** Invitar y reenviar: tope por negocio. Debe ir DESPUÉS de requireAuth. */
export const inviteRateLimit = build((req) => req.auth?.businessId, {
  name: 'rl:team-invite',
  max: 20,
  windowMs: 60 * 60 * 1000,
  message: 'Enviaste muchas invitaciones en poco tiempo. Esperá un rato e intentá de nuevo.',
});

/** Canje público: tope por IP. */
export const acceptInviteRateLimit = build((req) => req.ip || req.socket.remoteAddress || 'unknown', {
  name: 'rl:accept-invite',
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Demasiados intentos. Probá de nuevo en unos minutos.',
});
