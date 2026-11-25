import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, requireStaff } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { loadOverrideForUser } from '../middleware/capability';
import { prisma } from '../lib/prisma';
import { lockSingleton } from '../lib/singletonLock';
import { recordAuditEvent } from '../middleware/audit';
import { patchSchema } from '../validators/patch';
import { revokeUserSessions } from '../services/auth/revocation';
import { sendTeamInviteEmail } from '../services/email';
import {
  buildAcceptUrl,
  issueInviteTx,
  revokeInviteTx,
  listInviteExpiries,
  teamRoleToUserRole,
  TEAM_GUARD_LOCK,
} from '../services/team/invitations';
import { inviteRateLimit } from '../services/team/inviteRateLimit';
import {
  PERMISSION_CATALOG,
  ROLE_DEFAULTS,
  CAPABILITY_KEYS,
  PLAN_LABELS,
  loadPermissionOverrides,
  saveMemberPermissions,
  resolveCapabilities,
  normalizeRole,
  loadBusinessPlanTier,
  capabilitiesForPlan,
} from '../services/team/permissions';

// El rol del login (ADMIN | PROFESSIONAL | CLIENT) mapea al rol de equipo.
function authRoleToTeamRole(role: string): 'ADMIN' | 'PROFESSIONAL' | 'VIEWER' {
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'PROFESSIONAL') return 'PROFESSIONAL';
  return 'VIEWER';
}

// Los emails se guardan SIEMPRE en minúsculas: User.email es único global y el
// vínculo miembro <-> usuario (permisos, roles) se hace por email exacto.
const memberEmail = z
  .string()
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());

const inviteSchema = z.object({
  name: z.string().max(100).optional(),
  email: memberEmail,
  role: z.enum(['ADMIN', 'PROFESSIONAL', 'VIEWER']).default('VIEWER'),
});

// Solo el rol es editable. El estado (PENDING/ACTIVE) NO se toca a mano: lo mueve
// el canje de la invitación (PENDING -> ACTIVE) o la baja del miembro. Antes el
// schema aceptaba 'active'/'inactive', valores que ni existen en el enum.
const updateMemberSchema = patchSchema(
  z.object({
    role: z.enum(['ADMIN', 'PROFESSIONAL', 'VIEWER']),
  })
);

const permissionsSchema = z.object({
  permissions: z.array(z.enum(CAPABILITY_KEYS as [string, ...string[]])),
});

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  PROFESSIONAL: 'Profesional',
  VIEWER: 'Solo lectura (Viewer)',
};

// Lock transaccional (advisory, por negocio) que serializa invitar / cambiar rol /
// quitar miembros / canjear la invitación: sin él, dos admins que se degradan
// mutuamente a la vez pasarían ambos el chequeo de "queda otro admin" y el negocio
// quedaría sin administradores. Es SIEMPRE el primer lock (después van el de
// invitaciones y las filas); el orden es el mismo en el canje (ver invitations.ts).
const TEAM_GUARD = TEAM_GUARD_LOCK;

const REVOKE_ATTEMPTS = 3;

/**
 * Cierra las sesiones del usuario, con reintentos. Corre DESPUÉS del commit (el rol o
 * el estado ya cambiaron), así que si falla no podemos deshacer: devolvemos false y la
 * ruta responde éxito con `revocationFailed: true` en vez de un 500 engañoso. El
 * fallo queda en el log a nivel error para que alguien lo atienda: hasta que el JWT
 * venza (14 días) o se revoque a mano, esa sesión sigue viva.
 */
async function revokeSessionsWithRetry(businessId: string, userId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= REVOKE_ATTEMPTS; attempt++) {
    try {
      await revokeUserSessions(businessId, userId);
      return true;
    } catch (err) {
      if (attempt === REVOKE_ATTEMPTS) {
        console.error(
          `[team] ERROR: no se pudieron revocar las sesiones del usuario ${userId} (negocio ${businessId}) tras ${REVOKE_ATTEMPTS} intentos; su JWT sigue vivo hasta que venza.`,
          (err as Error).message,
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
  return false;
}

const LAST_ADMIN_ERROR =
  'No podés dejar al negocio sin administradores. Nombrá a otro administrador antes de hacer este cambio.';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Usuario de LOGIN vinculado al miembro: mismo email dentro del MISMO negocio. User.email
 * es único global, así que un usuario de otro negocio con ese email NO es de este
 * miembro y nunca se toca.
 */
async function findLinkedUser(tx: Tx, businessId: string, email: string) {
  const user = await tx.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  return user && user.businessId === businessId ? user : null;
}

/** ¿Hay al menos otro ADMIN activo en el negocio, además de `exceptUserId`? */
async function hasOtherActiveAdmin(tx: Tx, businessId: string, exceptUserId: string): Promise<boolean> {
  const others = await tx.user.count({
    where: {
      businessId,
      role: 'ADMIN',
      isActive: true,
      deletedAt: null,
      id: { not: exceptUserId },
    },
  });
  return others > 0;
}

/**
 * Manda el mail de invitación. NUNCA lanza (se llama después de commitear): devuelve
 * si salió, para que la UI sea honesta si no (sin RESEND_API_KEY, sin FRONTEND_URL...).
 */
async function deliverInvite(params: {
  businessId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
}): Promise<boolean> {
  try {
    const acceptUrl = buildAcceptUrl(params.token);
    if (!acceptUrl) {
      console.error('[team] FRONTEND_URL no está configurada: no se puede armar el link de invitación.');
      return false;
    }
    // Solo en desarrollo local Y con el flag explícito (sin proveedor de mail) el link se
    // imprime para poder probar el flujo. El link contiene el token: jamás en producción.
    if (
      String(process.env.NODE_ENV) !== 'production' &&
      String(process.env.NODE_ENV) === 'development' &&
      process.env.DEV_LOG_INVITE_LINKS === '1'
    ) {
      console.log(`[team] (solo dev) link de invitación para ${params.email}: ${acceptUrl}`);
    }
    const business = await prisma.business.findUnique({
      where: { id: params.businessId },
      select: { name: true },
    });
    return await sendTeamInviteEmail(params.email, {
      businessName: business?.name ?? 'un equipo',
      roleLabel: ROLE_LABELS[params.role] ?? params.role,
      acceptUrl,
      expiresLabel: params.expiresAt.toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    });
  } catch (err) {
    console.error('[team] No se pudo enviar la invitación:', (err as Error).message);
    return false;
  }
}

const router = Router();

// requireStaff: un CLIENT (VIEWER del equipo o cliente final del negocio) no debe
// poder listar los emails del equipo.
router.get(
  '/members',
  requireAuth,
  requireStaff,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const [members, expiries] = await Promise.all([
      prisma.teamMember.findMany({
        where: { businessId },
        orderBy: { joinedAt: 'desc' },
      }),
      listInviteExpiries(businessId),
    ]);
    // `inviteExpiresAt` solo sirve para mostrar "vence el..."; nunca se expone el hash.
    res.json(
      members.map((m) => ({
        ...m,
        inviteExpiresAt: m.status === 'PENDING' ? (expiries[m.id] ?? null) : null,
      }))
    );
  })
);

// Invita a un miembro: lo crea PENDING, emite un token de un solo uso (7 días; solo
// se guarda su hash) y manda el mail con el link. Si el mail no sale, el miembro y la
// invitación quedan creados y la respuesta lo dice (`emailSent: false`) para que el
// admin use "Reenviar". Un email de OTRO negocio se trata igual que uno nuevo
// (la respuesta no revela si existe); el canje falla en forma genérica.
router.post(
  '/invite',
  requireAuth,
  requireRole('ADMIN'),
  inviteRateLimit,
  validate(inviteSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { name, email, role } = req.body as z.infer<typeof inviteSchema>;

    const { member, issued } = await prisma.$transaction(async (tx) => {
      await lockSingleton(tx, businessId, TEAM_GUARD);

      const existing = await tx.teamMember.findUnique({
        where: { businessId_email: { businessId, email } },
      });
      if (existing) throw new AppError(409, 'Ese email ya es parte del equipo.');

      const linked = await findLinkedUser(tx, businessId, email);
      if (linked && linked.isActive && !linked.deletedAt) {
        throw new AppError(409, 'Ese email ya tiene una cuenta activa en tu negocio.');
      }

      const created = await tx.teamMember.create({
        data: {
          name: name || email.split('@')[0],
          email,
          role,
          status: 'PENDING',
          businessId,
        },
      });
      const issued = await issueInviteTx(tx, businessId, created.id, email);
      return { member: created, issued };
    });

    const emailSent = await deliverInvite({
      businessId,
      email,
      role,
      token: issued.token,
      expiresAt: issued.expiresAt,
    });

    recordAuditEvent({
      type: 'TEAM_INVITE_SENT',
      resource: req.originalUrl,
      userId: req.auth!.userId,
      businessId,
      ip: req.ip,
      metadata: { memberId: member.id, role, emailSent },
    });

    res.status(201).json({ ...member, emailSent, inviteExpiresAt: issued.expiresAt.toISOString() });
  })
);

// Reenvía la invitación: emite un token NUEVO (el anterior deja de servir) y vuelve a
// mandar el mail. Solo para miembros que todavía no aceptaron.
router.post(
  '/members/:id/resend',
  requireAuth,
  requireRole('ADMIN'),
  inviteRateLimit,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const memberId = req.params.id as string;

    const { member, issued } = await prisma.$transaction(async (tx) => {
      await lockSingleton(tx, businessId, TEAM_GUARD);
      const found = await tx.teamMember.findFirst({ where: { id: memberId, businessId } });
      if (!found) throw new AppError(404, 'Member not found');
      if (found.status !== 'PENDING') {
        throw new AppError(409, 'Este miembro ya aceptó la invitación.');
      }
      const linked = await findLinkedUser(tx, businessId, found.email);
      if (linked && linked.isActive && !linked.deletedAt) {
        throw new AppError(409, 'Ese email ya tiene una cuenta activa en tu negocio.');
      }
      const issued = await issueInviteTx(tx, businessId, found.id, found.email);
      return { member: found, issued };
    });

    const emailSent = await deliverInvite({
      businessId,
      email: member.email,
      role: member.role,
      token: issued.token,
      expiresAt: issued.expiresAt,
    });

    recordAuditEvent({
      type: 'TEAM_INVITE_SENT',
      resource: req.originalUrl,
      userId: req.auth!.userId,
      businessId,
      ip: req.ip,
      metadata: { memberId: member.id, role: member.role, emailSent, resend: true },
    });

    res.json({ id: member.id, emailSent, inviteExpiresAt: issued.expiresAt.toISOString() });
  })
);

// Cambia el rol del miembro. Los permisos reales salen de User.role (req.auth.role),
// no de TeamMember.role, así que acá se sincronizan los dos en una transacción. Como
// el rol viaja dentro del JWT, también se revocan las sesiones abiertas del usuario
// para que el cambio rija ya (si no, un ADMIN degradado seguiría siéndolo hasta 14 días).
router.patch(
  '/members/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateMemberSchema),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const memberId = req.params.id as string;
    const { role } = req.body as { role?: 'ADMIN' | 'PROFESSIONAL' | 'VIEWER' };

    const outcome = await prisma.$transaction(async (tx) => {
      await lockSingleton(tx, businessId, TEAM_GUARD);
      const member = await tx.teamMember.findFirst({ where: { id: memberId, businessId } });
      if (!member) throw new AppError(404, 'Member not found');

      let revokeUserId: string | null = null;
      let from: string | undefined;
      if (role && role !== member.role) {
        from = member.role;
        const linked = await findLinkedUser(tx, businessId, member.email);
        const newUserRole = teamRoleToUserRole(role);

        if (linked) {
          const wasAdmin = linked.role === 'ADMIN' && linked.isActive && !linked.deletedAt;
          if (wasAdmin && newUserRole !== 'ADMIN' && !(await hasOtherActiveAdmin(tx, businessId, linked.id))) {
            throw new AppError(
              409,
              linked.id === req.auth!.userId
                ? 'Sos el único administrador: no podés quitarte ese rol. Nombrá a otro administrador primero.'
                : LAST_ADMIN_ERROR
            );
          }
          if (linked.role !== newUserRole) {
            await tx.user.update({ where: { id: linked.id }, data: { role: newUserRole } });
            revokeUserId = linked.id;
          }
        }
        await tx.teamMember.updateMany({ where: { id: memberId, businessId }, data: { role } });
      }

      const updated = await tx.teamMember.findFirst({ where: { id: memberId, businessId } });
      return { updated, revokeUserId, from };
    });

    const revocationFailed = outcome.revokeUserId
      ? !(await revokeSessionsWithRetry(businessId, outcome.revokeUserId))
      : false;
    if (outcome.from && role) {
      recordAuditEvent({
        type: 'TEAM_ROLE_CHANGED',
        resource: req.originalUrl,
        userId: req.auth!.userId,
        businessId,
        ip: req.ip,
        metadata: { memberId, from: outcome.from, to: role, userSynced: !!outcome.revokeUserId, revocationFailed },
      });
    }
    // Si no se pudieron cerrar las sesiones, el cambio igual se aplicó: se avisa en vez de un 500.
    res.json(revocationFailed ? { ...outcome.updated, revocationFailed: true } : outcome.updated);
  })
);

// Quita al miembro: borra la fila, REVOCA su invitación pendiente (el link deja de
// servir) y, si ya tenía cuenta, la da de baja y cierra sus sesiones (antes seguía
// entrando con su contraseña / su JWT). No deja al negocio sin administradores.
router.delete(
  '/members/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const memberId = req.params.id as string;

    const { revokedInvite, deactivatedUserId } = await prisma.$transaction(async (tx) => {
      await lockSingleton(tx, businessId, TEAM_GUARD);
      const member = await tx.teamMember.findFirst({ where: { id: memberId, businessId } });
      if (!member) throw new AppError(404, 'Member not found');

      // Primero la invitación (lock de invitaciones) y recién después se resuelve el
      // usuario vinculado y se toca la fila del miembro: mismo orden que el canje. Si
      // más abajo salta el 409 de "último admin", la transacción entera se deshace y la
      // invitación NO queda revocada.
      const revokedInvite = await revokeInviteTx(tx, businessId, memberId);

      const linked = await findLinkedUser(tx, businessId, member.email);
      if (
        linked &&
        linked.role === 'ADMIN' &&
        linked.isActive &&
        !linked.deletedAt &&
        !(await hasOtherActiveAdmin(tx, businessId, linked.id))
      ) {
        throw new AppError(409, LAST_ADMIN_ERROR);
      }

      await tx.teamMember.deleteMany({ where: { id: memberId, businessId } });

      let deactivatedUserId: string | null = null;
      if (linked && linked.isActive) {
        await tx.user.update({ where: { id: linked.id }, data: { isActive: false } });
        deactivatedUserId = linked.id;
      }
      return { revokedInvite, deactivatedUserId };
    });

    const revocationFailed = deactivatedUserId
      ? !(await revokeSessionsWithRetry(businessId, deactivatedUserId))
      : false;
    recordAuditEvent({
      type: revokedInvite ? 'TEAM_INVITE_REVOKED' : 'TEAM_MEMBER_REMOVED',
      resource: req.originalUrl,
      userId: req.auth!.userId,
      businessId,
      ip: req.ip,
      metadata: { memberId, userDeactivated: !!deactivatedUserId, revocationFailed },
    });
    if (revocationFailed) {
      // El miembro se quitó y la cuenta quedó dada de baja; solo falló cerrar sus sesiones abiertas.
      res.status(200).json({ ok: true, revocationFailed: true });
      return;
    }
    res.status(204).send();
  })
);

// --- Permisos granulares por miembro ---

// Catálogo + defaults por rol + overrides actuales del negocio. Cualquier
// miembro autenticado puede leerlo (el front filtra su propio menú con esto).
router.get(
  '/permissions',
  requireAuth,
  requireStaff,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const [overrides, planTier] = await Promise.all([
      loadPermissionOverrides(businessId),
      loadBusinessPlanTier(businessId),
    ]);
    res.json({
      catalog: PERMISSION_CATALOG,
      roleDefaults: ROLE_DEFAULTS,
      overrides,
      planTier,
      planLabel: PLAN_LABELS[planTier],
      planCapabilities: capabilitiesForPlan(planTier),
    });
  })
);

// Acceso efectivo del usuario logueado: su rol ∩ el plan del negocio. Lo usa el
// menú lateral para mostrar/bloquear secciones según el plan.
router.get(
  '/my-access',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const teamRole = authRoleToTeamRole(req.auth!.role);
    // Igual que requireCapability: el menú debe reflejar el override por miembro,
    // no solo el default del rol. Si no, el menú muestra ítems que al entrar dan
    // 403. ADMIN nunca se capa, así que ni cargamos su override.
    const [planTier, override] = await Promise.all([
      loadBusinessPlanTier(businessId),
      teamRole === 'ADMIN'
        ? Promise.resolve(undefined)
        : loadOverrideForUser(businessId, req.auth!.userId),
    ]);
    const roleCapabilities = resolveCapabilities(teamRole, override);
    res.json({
      planTier,
      planLabel: PLAN_LABELS[planTier],
      roleCapabilities,
      planCapabilities: capabilitiesForPlan(planTier),
    });
  })
);

// Sobrescribe las capacidades de un miembro. Solo ADMIN. Un array vacío borra
// el override (vuelve al default del rol). Un ADMIN no se puede capar: siempre
// mantiene todas las capacidades.
router.put(
  '/permissions/:memberId',
  requireAuth,
  requireRole('ADMIN'),
  validate(permissionsSchema),
  asyncHandler(async (req, res) => {
    const memberId = req.params.memberId as string;
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, businessId: req.auth!.businessId },
      select: { role: true },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const role = normalizeRole(member.role);
    const permissions = await saveMemberPermissions(
      req.auth!.businessId,
      memberId,
      req.body.permissions,
      role,
    );
    res.json({ memberId, role, permissions });
  })
);

// Resetea las capacidades de un miembro al default de su rol. Solo ADMIN.
router.delete(
  '/permissions/:memberId',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const memberId = req.params.memberId as string;
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, businessId: req.auth!.businessId },
      select: { role: true },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const role = normalizeRole(member.role);
    await saveMemberPermissions(req.auth!.businessId, memberId, [], role);
    res.json({ memberId, role, permissions: resolveCapabilities(role) });
  })
);

export const teamRouter = router;
