import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { Sentry } from '../lib/sentry';

/**
 * Error de aplicación con código de estado HTTP explícito.
 * Úsese para errores de negocio controlados (ej: recurso no encontrado, conflicto, etc).
 */
export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Envuelve un handler async para reenviar cualquier error a next(),
 * evitando repetir try/catch en cada ruta.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Mapea códigos de error conocidos de Prisma a una respuesta HTTP consistente. */
function handlePrismaError(err: Prisma.PrismaClientKnownRequestError, res: Response) {
  switch (err.code) {
    case 'P2002': {
      const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]).join(', ') : 'campo';
      res.status(409).json({ error: `Ya existe un registro con ese ${target}` });
      return;
    }
    case 'P2025':
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    case 'P2003':
      res.status(400).json({ error: 'Referencia inválida: el recurso relacionado no existe' });
      return;
    case 'P2014':
      res.status(400).json({ error: 'La operación viola una relación requerida entre registros' });
      return;
    default:
      res.status(400).json({ error: 'Error al procesar la solicitud en la base de datos' });
      return;
  }
}

/**
 * Middleware de manejo de errores centralizado. Debe registrarse al final,
 * después de montar todas las rutas.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    handlePrismaError(err, res);
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: 'Datos inválidos para la operación solicitada' });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, details: err.details });
    return;
  }

  console.error('Unhandled error:', err);
  if (err instanceof Error) {
    Sentry.captureException(err);
  }
  res.status(500).json({ error: 'Internal server error' });
}

/** Middleware para rutas no encontradas (404). Debe registrarse antes del errorHandler. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}
