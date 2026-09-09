import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const updateWhitelabelSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  logo: z.string().url().max(500).optional().nullable(),
  primaryColor: z.string().max(20).optional(),
  secondaryColor: z.string().max(20).optional(),
  accentColor: z.string().max(20).optional(),
  customDomain: z.string().max(253).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  whatsappNumber: z.string().max(30).optional().nullable(),
  instagramUrl: z.string().url().max(500).optional().nullable(),
  facebookUrl: z.string().url().max(500).optional().nullable(),
  websiteUrl: z.string().url().max(500).optional().nullable(),
});

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const business = await prisma.business.findUnique({
      where: { id: req.auth!.businessId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logo: true,
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
        customDomain: true,
        phone: true,
        whatsappNumber: true,
        instagramUrl: true,
        facebookUrl: true,
        websiteUrl: true,
      },
    });
    res.json(business);
  })
);

router.patch(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateWhitelabelSchema),
  asyncHandler(async (req, res) => {
    const { name, description, logo, primaryColor, secondaryColor, accentColor, customDomain, phone, whatsappNumber, instagramUrl, facebookUrl, websiteUrl } = req.body;
    const business = await prisma.business.update({
      where: { id: req.auth!.businessId },
      data: { name, description, logo, primaryColor, secondaryColor, accentColor, customDomain, phone, whatsappNumber, instagramUrl, facebookUrl, websiteUrl },
    });
    res.json(business);
  })
);

router.get(
  '/preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const business = await prisma.business.findUnique({
      where: { id: req.auth!.businessId },
      include: { services: { where: { isActive: true }, take: 6 } },
    });
    res.json({
      business,
      previewUrl: `https://localb.com/${business?.slug || 'preview'}`,
    });
  })
);

export const whitelabelRouter = router;
