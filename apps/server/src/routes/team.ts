import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
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

const inviteSchema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'PROFESSIONAL', 'VIEWER']).default('VIEWER'),
});

const updateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'PROFESSIONAL', 'VIEWER']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const permissionsSchema = z.object({
  permissions: z.array(z.enum(CAPABILITY_KEYS as [string, ...string[]])),
});

const router = Router();

router.get(
  '/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const members = await prisma.teamMember.findMany({
      where: { businessId: req.auth!.businessId },
      orderBy: { joinedAt: 'desc' },
    });
    res.json(members);
  })
);

router.post(
  '/invite',
  requireAuth,
  requireRole('ADMIN'),
  validate(inviteSchema),
  asyncHandler(async (req, res) => {
    const { name, email, role } = req.body;
    const existing = await prisma.teamMember.findUnique({
      where: { businessId_email: { businessId: req.auth!.businessId, email } },
    });
    if (existing) return res.status(409).json({ error: 'Member already exists' });
    const member = await prisma.teamMember.create({
      data: {
        name: name || email.split('@')[0],
        email,
        role: role || 'VIEWER',
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(member);
  })
);

router.patch(
  '/members/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateMemberSchema),
  asyncHandler(async (req, res) => {
    const { role, status } = req.body;
    const upd = await prisma.teamMember.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      data: { role, status },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Member not found' });
    const member = await prisma.teamMember.findFirst({ where: { id: req.params.id as string, businessId: req.auth!.businessId } });
    res.json(member);
  })
);

router.delete(
  '/members/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.teamMember.deleteMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Member not found' });
    res.status(204).send();
  })
);

// --- Permisos granulares por miembro ---

// Catálogo + defaults por rol + overrides actuales del negocio. Cualquier
// miembro autenticado puede leerlo (el front filtra su propio menú con esto).
router.get(
  '/permissions',
  requireAuth,
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
    const planTier = await loadBusinessPlanTier(businessId);
    const roleCapabilities = resolveCapabilities(authRoleToTeamRole(req.auth!.role));
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
