/**
 * Límite de cuerpo JSON según la ruta.
 *
 * Las rutas SIN autenticación (chat público, reservas públicas, login/registro/OTP)
 * solo reciben cuerpos chicos (un mensaje, credenciales, datos de contacto). Con el
 * límite global de 5 MB, cualquiera sin sesión podía obligar al server a parsear y
 * validar con zod 5 MB de JSON (p. ej. un array enorme) por request. Acá las
 * acotamos a 100 KB; el resto de la API conserva los 5 MB.
 *
 * Los webhooks de terceros (Meta, Telegram, Stripe, Twilio...) NO entran en esta
 * lista: tienen su propio tamaño y firma, y cortarlos perdería mensajes.
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { validateRequestSize } from './security';

export const PUBLIC_BODY_PREFIXES = ['/api/public', '/api/auth'] as const;
export const PUBLIC_BODY_LIMIT_BYTES = 100 * 1024; // 100 KB
export const DEFAULT_BODY_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

type VerifyFn = (req: Request, res: Response, buf: Buffer) => void;

export function isPublicBodyPath(path: string): boolean {
  return PUBLIC_BODY_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * Rechaza rápido (413 por Content-Length) los cuerpos grandes en rutas públicas,
 * antes de leer el stream. Va ANTES del parser.
 */
export const publicBodySizeGuard: RequestHandler = (req, res, next) => {
  if (!isPublicBodyPath(req.path)) return next();
  return validateRequestSize({ maxBodyBytes: PUBLIC_BODY_LIMIT_BYTES })(req, res, next);
};

/**
 * Parser JSON con límite por ruta: 100 KB en las públicas, 5 MB en el resto.
 * El límite del parser también cubre cuerpos sin Content-Length (chunked).
 */
export function jsonBodyParser(verify?: VerifyFn): RequestHandler {
  const publicParser = express.json({ limit: PUBLIC_BODY_LIMIT_BYTES, verify });
  const defaultParser = express.json({ limit: DEFAULT_BODY_LIMIT_BYTES, verify });
  return (req: Request, res: Response, next: NextFunction) =>
    (isPublicBodyPath(req.path) ? publicParser : defaultParser)(req, res, next);
}
