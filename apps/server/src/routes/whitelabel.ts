import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

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
