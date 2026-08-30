import { Request, Response, NextFunction } from 'express';

/**
 * audit.ts
 * ------------------------------------------------------------------
 * Middleware de auditoría (logging de seguridad) para Local B.
 *
 * Registra eventos relevantes para trazabilidad y forense:
 *   - Eventos de autenticación (login exitoso/fallido, registro, logout)
 *   - Mutaciones de datos (create/update/delete)
 *   - Violaciones de rate limiting
 *
 * En desarrollo se imprime en formato legible por humanos. En
 * producción se emite JSON estructurado por línea (compatible con
 * colectores de logs como CloudWatch, Datadog, ELK, etc).
 * ------------------------------------------------------------------
 */

export type AuditEventType =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'AUTH_REGISTER'
  | 'AUTH_LOGOUT'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'DATA_CREATE'
  | 'DATA_UPDATE'
  | 'DATA_DELETE'
  | 'RATE_LIMIT_EXCEEDED';

export interface AuditEvent {
  type: AuditEventType;
  /** Ruta/recurso afectado, ej: "/api/auth/login" o "bookings" */
  resource: string;
  /** ID del usuario autenticado, si corresponde */
  userId?: string;
  /** ID del negocio (multi-tenant), si corresponde */
  businessId?: string;
  /** IP de origen de la petición */
  ip?: string;
  /** Detalles adicionales no sensibles (nunca incluir contraseñas ni tokens) */
  metadata?: Record<string, unknown>;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Emite un evento de auditoría al log.
 * - Desarrollo: línea legible con colores/formato simple.
 * - Producción: JSON estructurado de una sola línea (facilita el parseo).
 */
export function recordAuditEvent(event: AuditEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'audit',
    ...event,
  };

  if (isProduction) {
    // Formato JSON estructurado: una línea por evento.
    console.log(JSON.stringify(entry));
    return;
  }

  const parts = [
    `[AUDIT] ${entry.timestamp}`,
    `tipo=${event.type}`,
    `recurso=${event.resource}`,
    event.userId ? `usuario=${event.userId}` : null,
    event.businessId ? `negocio=${event.businessId}` : null,
    event.ip ? `ip=${event.ip}` : null,
  ].filter(Boolean);

  console.log(parts.join(' | '));
  if (event.metadata && Object.keys(event.metadata).length > 0) {
    console.log('  detalles:', event.metadata);
  }
}

/**
 * Helper específico para eventos de autenticación. Se invoca
 * manualmente desde las rutas de auth (login/register/logout) ya
 * que estas requieren conocer el resultado de la operación
 * (éxito/fallo) que no es deducible únicamente a partir del
 * request/response genérico.
 */
export function auditAuthEvent(
  type: Extract<
    AuditEventType,
    'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_FAILURE' | 'AUTH_REGISTER' | 'AUTH_LOGOUT' | 'AUTH_ACCOUNT_LOCKED'
  >,
  req: Request,
  extra: { userId?: string; businessId?: string; metadata?: Record<string, unknown> } = {}
) {
  recordAuditEvent({
    type,
    resource: req.originalUrl,
    ip: getClientIp(req),
    userId: extra.userId,
    businessId: extra.businessId,
    metadata: extra.metadata,
  });
}

/**
 * Middleware genérico que audita mutaciones de datos (POST/PUT/
 * PATCH/DELETE) en las rutas de recursos de negocio. Se engancha
 * DESPUÉS de que la respuesta fue enviada, registrando solo
 * operaciones que terminaron en un código de éxito (2xx).
 *
 * No registra el cuerpo completo de la petición para evitar filtrar
 * datos sensibles en los logs; solo metadatos (método, ruta, status).
 */
export function auditDataMutations(req: Request, res: Response, next: NextFunction) {
  const mutatingMethods: Record<string, AuditEventType> = {
    POST: 'DATA_CREATE',
    PUT: 'DATA_UPDATE',
    PATCH: 'DATA_UPDATE',
    DELETE: 'DATA_DELETE',
  };

  const auditType = mutatingMethods[req.method];
  if (!auditType) {
    next();
    return;
  }

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      recordAuditEvent({
        type: auditType,
        resource: req.originalUrl,
        userId: req.auth?.userId,
        businessId: req.auth?.businessId,
        ip: getClientIp(req),
        metadata: { method: req.method, status: res.statusCode },
      });
    }
  });

  next();
}

/**
 * Middleware para registrar violaciones de rate limiting. Debe
 * ubicarse dentro del handler de rate limit cuando se rechaza una
 * petición (status 429), o usarse envolviendo la respuesta como se
 * muestra aquí mediante el evento 'finish'.
 */
export function auditRateLimitViolations(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    if (res.statusCode === 429) {
      recordAuditEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        resource: req.originalUrl,
        ip: getClientIp(req),
        metadata: { method: req.method },
      });
    }
  });
  next();
}

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
