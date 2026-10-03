import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
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
    const businessId = req.auth!.businessId;
    const data = { name, description, logo, primaryColor, secondaryColor, accentColor, customDomain, phone, whatsappNumber, instagramUrl, facebookUrl, websiteUrl };

    // Anti-hijack de número: un phone/whatsappNumber no puede pertenecer a dos
    // negocios (si no, los mensajes/llamadas entrantes a ese número podían caer
    // en el tenant del atacante). Si otro negocio ya usa alguno de los números
    // que se intentan guardar, rechazamos (409). Advisory lock para serializar
    // guardados concurrentes del mismo número.
    const numbers = [phone, whatsappNumber]
      .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      .map((n) => n.trim());

    const business = await prisma.$transaction(async (tx) => {
      if (numbers.length > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'biznum:' + numbers.join('|')}, 0))`;
        const taken = await tx.business.findFirst({
          where: {
            id: { not: businessId },
            OR: numbers.flatMap((n) => [{ phone: n }, { whatsappNumber: n }]),
          },
          select: { id: true },
        });
        if (taken) throw new AppError(409, 'Ese número de teléfono/WhatsApp ya está en uso por otro negocio.');
      }
      return tx.business.update({ where: { id: businessId }, data });
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
