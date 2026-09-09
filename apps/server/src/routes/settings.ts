import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { updateSettingsSchema, UpdateSettingsInput } from '../validators/settings';

const updateAIProviderSchema = z.object({
  apiKey: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

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

// --- AI Providers (stored as Connection type='ai_provider') ---

const AI_PROVIDERS = [
  { key: 'anthropic', label: 'Claude (Anthropic)' },
  { key: 'openai', label: 'ChatGPT (OpenAI)' },
  { key: 'google', label: 'Gemini (Google)' },
  { key: 'xai', label: 'Grok (xAI)' },
];

router.get(
  '/ai-providers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const connections = await prisma.connection.findMany({
      where: { businessId: req.auth!.businessId, type: 'ai_provider' },
    });
    const result = AI_PROVIDERS.map((p) => {
      const conn = connections.find(
        (c) => (c.config as Record<string, unknown>)?.provider === p.key
      );
      return {
        key: p.key,
        label: p.label,
        configured: !!conn,
        isActive: conn?.isActive ?? false,
        id: conn?.id ?? null,
      };
    });
    res.json(result);
  })
);

router.put(
  '/ai-providers/:providerKey',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateAIProviderSchema),
  asyncHandler(async (req, res) => {
    const { providerKey } = req.params;
    const provider = AI_PROVIDERS.find((p) => p.key === providerKey);
    if (!provider) throw new AppError(400, 'Proveedor no válido');

    const { apiKey, isActive } = req.body;
    const businessId = req.auth!.businessId;

    const existing = await prisma.connection.findFirst({
      where: {
        businessId,
        type: 'ai_provider',
        config: { path: ['provider'], equals: providerKey },
      },
    });

    if (existing) {
      const updateData: Record<string, unknown> = {};
      if (typeof isActive === 'boolean') updateData.isActive = isActive;
      if (apiKey !== undefined) {
        updateData.config = {
          provider: providerKey,
          apiKey: apiKey || null,
        };
      }
      const updated = await prisma.connection.update({
        where: { id: existing.id },
        data: updateData,
      });
      res.json({
        key: providerKey,
        label: provider.label,
        configured: !!(updated.config as Record<string, unknown>)?.apiKey,
        isActive: updated.isActive,
        id: updated.id,
      });
    } else {
      const created = await prisma.connection.create({
        data: {
          name: provider.label,
          type: 'ai_provider',
          isActive: isActive ?? true,
          config: { provider: providerKey, apiKey: apiKey || null },
          businessId,
        },
      });
      res.json({
        key: providerKey,
        label: provider.label,
        configured: !!apiKey,
        isActive: created.isActive,
        id: created.id,
      });
    }
  })
);

router.delete(
  '/ai-providers/:providerKey',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { providerKey } = req.params;
    const businessId = req.auth!.businessId;

    const existing = await prisma.connection.findFirst({
      where: {
        businessId,
        type: 'ai_provider',
        config: { path: ['provider'], equals: providerKey },
      },
    });
    if (!existing) throw new AppError(404, 'Proveedor no configurado');

    await prisma.connection.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

export { router as settingsRouter };
