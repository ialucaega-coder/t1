import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const inviteSchema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'PROFESSIONAL', 'VIEWER']).default('VIEWER'),
});

const updateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'PROFESSIONAL', 'VIEWER']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
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
    const member = await prisma.teamMember.findUnique({ where: { id: req.params.id as string } });
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

export const teamRouter = router;
