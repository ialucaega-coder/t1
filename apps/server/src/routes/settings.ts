import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { updateSettingsSchema, UpdateSettingsInput } from '../validators/settings';

const router = Router();

const DEFAULT_AI_PROVIDERS = ['Claude (Anthropic)', 'ChatGPT (OpenAI)', 'Gemini (Google)', 'Grok (xAI)'];

function mapBusinessSettings(business: {
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  theme: string;
  accentColor: string;
}) {
  return {
    businessName: business.name,
    slug: business.slug,
    phone: business.phone ?? '',
    email: business.email ?? '',
    address: business.address ?? '',
    timezone: business.timezone,
    currency: business.currency,
    theme: business.theme,
    accentColor: business.accentColor,
    aiProviders: DEFAULT_AI_PROVIDERS,
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const business = await prisma.business.findUnique({ where: { id: req.auth!.businessId } });
    if (!business) throw new AppError(404, 'Negocio no encontrado');
    res.json(mapBusinessSettings(business));
  })
);

router.put(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as UpdateSettingsInput;
    const update = {
      ...(data.businessName !== undefined ? { name: data.businessName } : {}),
      ...(data.slug !== undefined ? { slug: data.slug } : {}),
      ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(data.email !== undefined ? { email: data.email || null } : {}),
      ...(data.address !== undefined ? { address: data.address || null } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.currency !== undefined ? { currency: data.currency } : {}),
      ...(data.theme !== undefined ? { theme: data.theme } : {}),
      ...(data.accentColor !== undefined ? { accentColor: data.accentColor } : {}),
    };

    try {
      const business = await prisma.business.update({
        where: { id: req.auth!.businessId },
        data: update,
      });
      res.json(mapBusinessSettings(business));
    } catch (error: unknown) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
        throw new AppError(409, 'El slug ya esta en uso');
      }
      throw error;
    }
  })
);

export { router as settingsRouter };
