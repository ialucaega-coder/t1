import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, requireStaff } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { businessNameSchema } from '../validators/common';
import { imageUrlSchema } from '../validators/image-url';
import { httpsUrlSchema } from '../validators/https-url';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { assertPhoneNumbersFree, normalizeOptionalPhone } from '../lib/businessPhone';
import {
  WHITELABEL_THEMES,
  WHITELABEL_SECTIONS,
  loadWhitelabelUi,
  saveWhitelabelUi,
} from '../services/whitelabel/config';

/** #RRGGBB (los colores se inyectan en estilos del panel y páginas públicas). */
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'El color debe ser #RRGGBB');

/**
 * Hostname de un dominio propio: etiquetas de 1 a 63 caracteres [a-z0-9-] sin guion
 * al borde, al menos un punto y TLD alfabético; en minúsculas. Vacío => se borra.
 */
const HOSTNAME_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const customDomainSchema = z.union([
  z.literal('').transform(() => null),
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(HOSTNAME_REGEX, 'El dominio no es válido (ej: reservas.minegocio.com)'),
]);

const updateWhitelabelSchema = z.object({
  name: businessNameSchema(1).optional(),
  description: z.string().max(1000).optional(),
  logo: imageUrlSchema.optional().nullable(),
  primaryColor: hexColor.optional(),
  secondaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  customDomain: customDomainSchema.optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  whatsappNumber: z.string().max(30).optional().nullable(),
  instagramUrl: httpsUrlSchema.optional().nullable(),
  facebookUrl: httpsUrlSchema.optional().nullable(),
  websiteUrl: httpsUrlSchema.optional().nullable(),
  // Config de UI del panel (se persiste aparte, en Connection type='WHITELABEL_UI').
  theme: z.enum(WHITELABEL_THEMES).optional(),
  hiddenSections: z.array(z.enum(WHITELABEL_SECTIONS)).max(WHITELABEL_SECTIONS.length).optional(),
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
    const ui = await loadWhitelabelUi(req.auth!.businessId);
    res.json({ ...business, theme: ui.theme, hiddenSections: ui.hiddenSections });
  })
);

router.patch(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateWhitelabelSchema),
  asyncHandler(async (req, res) => {
    const { name, description, logo, primaryColor, secondaryColor, accentColor, customDomain, instagramUrl, facebookUrl, websiteUrl, theme, hiddenSections } = req.body;
    const businessId = req.auth!.businessId;

    // Teléfono y WhatsApp se guardan en formato canónico (+dígitos): las llamadas y
    // mensajes entrantes se asignan al negocio por coincidencia exacta.
    const phone = normalizeOptionalPhone(req.body.phone, 'teléfono');
    const whatsappNumber = normalizeOptionalPhone(req.body.whatsappNumber, 'número de WhatsApp');
    const data = { name, description, logo, primaryColor, secondaryColor, accentColor, customDomain, phone, whatsappNumber, instagramUrl, facebookUrl, websiteUrl };

    const numbers = [phone, whatsappNumber].filter((n): n is string => typeof n === 'string');

    const business = await prisma.$transaction(async (tx) => {
      // Anti-hijack de número (guard compartido con PUT /settings): un
      // phone/whatsappNumber no puede pertenecer a dos negocios. 409 si ya lo usa otro.
      await assertPhoneNumbersFree(tx, businessId, numbers);

      // Dominio propio: único entre negocios (si no, uno secuestraría el host del
      // otro). Advisory lock para serializar guardados concurrentes del mismo dominio.
      if (typeof customDomain === 'string') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'bizdomain:' + customDomain}, 0))`;
        const taken = await tx.business.findFirst({
          where: { id: { not: businessId }, customDomain },
          select: { id: true },
        });
        if (taken) throw new AppError(409, 'Ese dominio ya está en uso por otro negocio.');
      }

      return tx.business.update({ where: { id: businessId }, data });
    });

    // La config de UI del panel (tema / secciones ocultas) se persiste aparte,
    // en Connection type='WHITELABEL_UI'. Solo la tocamos si vino en el parche.
    let ui = { theme: undefined as string | undefined, hiddenSections: undefined as string[] | undefined };
    if (theme !== undefined || hiddenSections !== undefined) {
      const saved = await saveWhitelabelUi(businessId, { theme, hiddenSections });
      ui = saved;
    } else {
      const loaded = await loadWhitelabelUi(businessId);
      ui = loaded;
    }

    res.json({ ...business, theme: ui.theme, hiddenSections: ui.hiddenSections });
  })
);

// Vista previa de la marca para el panel. Solo staff y con `select` explícito: antes
// devolvía el Business completo (stripeCustomerId, plan, etc.) a cualquier usuario
// autenticado, incluso un CLIENT.
router.get(
  '/preview',
  requireAuth,
  requireStaff,
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
        services: {
          where: { isActive: true },
          take: 6,
          select: { id: true, name: true, description: true, price: true, duration: true, currency: true },
        },
      },
    });
    res.json({
      business,
      previewUrl: `https://localb.com/${business?.slug || 'preview'}`,
    });
  })
);

export const whitelabelRouter = router;
