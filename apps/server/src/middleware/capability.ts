import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import {
  loadBusinessPlanTier,
  capabilitiesForPlan,
  resolveCapabilities,
  loadPermissionOverrides,
} from '../services/team/permissions';

// El rol del login (ADMIN | PROFESSIONAL | CLIENT) mapea al rol de equipo.
function authRoleToTeamRole(role: string): 'ADMIN' | 'PROFESSIONAL' | 'VIEWER' {
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'PROFESSIONAL') return 'PROFESSIONAL';
  return 'VIEWER';
}

/**
 * Resuelve el override por-miembro para el usuario autenticado, si existe.
 *
 * Detalle de arquitectura: el modal de Equipo guarda los overrides por
 * `TeamMember.id`, pero quien se autentica es un `User` (modelos distintos, sin
 * relación formal en el schema congelado). Los vinculamos por email dentro del
 * mismo negocio. Si no hay override para ese miembro, devolvemos undefined y el
 * resolver cae al default del rol.
 */
async function loadOverrideForUser(
  businessId: string,
  userId: string
): Promise<string[] | undefined> {
  const overrides = await loadPermissionOverrides(businessId);
  if (Object.keys(overrides).length === 0) return undefined;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return undefined;
  const member = await prisma.teamMember.findFirst({
    where: { businessId, email: user.email },
    select: { id: true },
  });
  if (!member) return undefined;
  return overrides[member.id];
}

/**
 * Exige que el usuario tenga habilitada una capacidad. Capacidad efectiva =
 * (override del miembro, o default del rol) ∩ (plan del negocio). Es el espejo
 * en el backend del RouteGuard del front: aunque alguien llame la API directo,
 * una herramienta fuera de su plan/rol/override devuelve 403.
 *
 * ADMIN nunca se capa (resolveCapabilities le da todas). Los overrides por
 * miembro que configura el admin AHORA SÍ se aplican en el backend (antes eran
 * solo visuales). Debe ir DESPUÉS de requireAuth (necesita req.auth).
 *
 * Nota: esto es gating de PRODUCTO (entitlements), no el aislamiento
 * multi-tenant (ese ya lo hace cada ruta scopeando por businessId).
 */
export function requireCapability(capability: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    try {
      const teamRole = authRoleToTeamRole(req.auth.role);
      const planTier = await loadBusinessPlanTier(req.auth.businessId);
      const planCaps = capabilitiesForPlan(planTier);

      // El ADMIN tiene todas las capacidades, así que ni cargamos overrides.
      const override =
        teamRole === 'ADMIN'
          ? undefined
          : await loadOverrideForUser(req.auth.businessId, req.auth.userId);

      const roleCaps = resolveCapabilities(teamRole, override);
      const effective = roleCaps.filter((c) => planCaps.includes(c));
      if (!effective.includes(capability)) {
        res.status(403).json({
          error: 'Esta herramienta no está disponible en tu plan o tu rol.',
          capability,
          planTier,
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: 'No se pudo verificar los permisos' });
    }
  };
}
