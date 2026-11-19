import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { updateSettingsSchema, UpdateSettingsInput } from '../validators/settings';
import { assertPhoneNumbersFree, normalizeOptionalPhone } from '../lib/businessPhone';

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
    const businessId = req.auth!.businessId;
    // El teléfono se guarda en formato canónico (+dígitos): la resolución de
    // llamadas/mensajes entrantes compara por coincidencia exacta.
    const phone = normalizeOptionalPhone(data.phone);
    const update = {
      ...(data.businessName !== undefined ? { name: data.businessName } : {}),
      ...(data.slug !== undefined ? { slug: data.slug } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(data.email !== undefined ? { email: data.email || null } : {}),
      ...(data.address !== undefined ? { address: data.address || null } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.currency !== undefined ? { currency: data.currency } : {}),
      ...(data.theme !== undefined ? { theme: data.theme } : {}),
      ...(data.accentColor !== undefined ? { accentColor: data.accentColor } : {}),
    };

    try {
      // Mismo guard anti-hijack que White Label: el número no puede pertenecer a
      // dos negocios (si no, las llamadas/mensajes entrantes caerían en el otro).
      const business = await prisma.$transaction(async (tx) => {
        if (typeof phone === 'string') await assertPhoneNumbersFree(tx, businessId, [phone]);
        return tx.business.update({ where: { id: businessId }, data: update });
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

// La configuración de IA ("usá tu propia IA") vive en el Motor de IA real:
// rutas /api/ai/engines, /api/ai/engine y /api/ai/keys (services/ai/engine.ts),
// que es lo que el chatbot efectivamente usa. Antes existía acá un stub
// (type='ai_provider') que guardaba keys que ningún canal leía; se eliminó para
// no mostrar proveedores "configurados" que en realidad no alimentaban al bot.

export { router as settingsRouter };
