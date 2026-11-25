/**
 * Guard del Super Admin de la plataforma (el DUEÑO, un nivel por encima del
 * ADMIN de cada negocio).
 *
 * A diferencia de los roles de negocio (que viven en el JWT como `req.auth.role`),
 * ser Super Admin NO es un rol del schema (congelado): es una allowlist por email
 * en la variable de entorno `PLATFORM_ADMIN_EMAILS` (lista separada por comas,
 * case-insensitive, con trim). Así no hace falta ningún modelo ni columna nueva.
 *
 * Debe montarse SIEMPRE después de `requireAuth` (necesita `req.auth.userId`).
 *
 * Política ante error o config ausente: FALLA CERRADO (403). Si no se puede leer
 * el usuario, o la allowlist está vacía, nadie entra: el panel del dueño expone
 * acciones cross-tenant (suspender negocios, cambiar planes), así que preferimos
 * negar el acceso antes que arriesgar una apertura por un fallo puntual.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

/** Parsea la allowlist de emails de la env, normalizada (trim + minúsculas). */
function platformAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const allowlist = platformAdminEmails();
  // Sin allowlist configurada no hay Super Admins posibles: fallamos cerrado.
  if (allowlist.size === 0) {
    res.status(403).json({ error: 'Platform admin access required' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { email: true },
    });

    const email = user?.email?.trim().toLowerCase();
    if (!email || !allowlist.has(email)) {
      res.status(403).json({ error: 'Platform admin access required' });
      return;
    }

    next();
  } catch {
    // Fail closed: ante cualquier error leyendo el usuario, negamos el acceso.
    res.status(403).json({ error: 'Platform admin access required' });
  }
}
