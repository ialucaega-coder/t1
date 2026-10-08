import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getAuthSecret } from '../lib/secrets';
import { isSessionRevoked } from '../services/auth/revocation';

export interface AuthPayload {
  userId: string;
  businessId: string;
  role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT';
}

/** Roles que son "staff" del panel (no clientes finales). */
export const STAFF_ROLES: AuthPayload['role'][] = ['ADMIN', 'PROFESSIONAL'];

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, getAuthSecret()) as AuthPayload & { iat?: number };
    // Revocación pasiva: un token emitido antes del corte del usuario (logout,
    // cambio de contraseña, baja) se rechaza aunque siga sin expirar.
    if (await isSessionRevoked(payload.businessId, payload.userId, payload.iat)) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles: AuthPayload['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Exige que el usuario sea staff del panel (ADMIN o PROFESSIONAL), no un
 * CLIENT final. Los clientes se autentican con el mismo esquema JWT (para
 * reservas/portal), pero NO deben acceder a los endpoints del panel: datos de
 * otros clientes (PII), conversaciones, exportaciones, integraciones, envíos.
 * Este guard es el piso de esos endpoints, por encima de `requireAuth`.
 */
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!STAFF_ROLES.includes(req.auth.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  next();
}
