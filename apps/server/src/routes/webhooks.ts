import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { assertSafePublicUrl } from '../lib/ssrf';

const router = Router();

const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.updated',
  'booking.cancelled',
  'order.created',
  'order.updated',
  'client.created',
  'transaction.created',
  'conversation.new_message',
  'campaign.sent',
] as const;

const createWebhookSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().max(200).optional(),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const webhooks = await prisma.connection.findMany({
      where: { businessId: _req.auth!.businessId, type: 'webhook' },
      orderBy: { name: 'asc' },
    });
    res.json(webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      isActive: w.isActive,
      ...(w.config as Record<string, unknown> || {}),
    })));
  })
);

router.get(
  '/events',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(WEBHOOK_EVENTS);
  })
);

router.post(
  '/',
  requireAuth,
  validate(createWebhookSchema),
  asyncHandler(async (req, res) => {
    const { name, url, events, secret } = req.body;
    // Anti-SSRF: no permitimos guardar un destino interno/privado.
    await assertSafePublicUrl(url);
    const webhook = await prisma.connection.create({
      data: {
        name,
        type: 'webhook',
        isActive: true,
        config: { url, events, secret: secret || null },
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json({
      id: webhook.id,
      name: webhook.name,
      isActive: webhook.isActive,
      ...(webhook.config as Record<string, unknown>),
    });
  })
);

router.patch(
  '/:id',
  requireAuth,
  validate(updateWebhookSchema),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.connection.findFirst({
      where: { id, businessId: req.auth!.businessId, type: 'webhook' },
    });
    if (!existing) throw new AppError(404, 'Webhook not found');

    const currentConfig = (existing.config as Record<string, unknown>) || {};
    const { name, url, events, secret, isActive } = req.body;
    // Anti-SSRF al actualizar la URL.
    if (url !== undefined) await assertSafePublicUrl(url);

    const webhook = await prisma.connection.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(isActive !== undefined && { isActive }),
        config: {
          ...currentConfig,
          ...(url !== undefined && { url }),
          ...(events !== undefined && { events }),
          ...(secret !== undefined && { secret }),
        },
      },
    });
    res.json({
      id: webhook.id,
      name: webhook.name,
      isActive: webhook.isActive,
      ...(webhook.config as Record<string, unknown>),
    });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.connection.findFirst({
      where: { id, businessId: req.auth!.businessId, type: 'webhook' },
    });
    if (!existing) throw new AppError(404, 'Webhook not found');
    await prisma.connection.delete({ where: { id } });
    res.status(204).send();
  })
);

router.post(
  '/:id/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const webhook = await prisma.connection.findFirst({
      where: { id, businessId: req.auth!.businessId, type: 'webhook' },
    });
    if (!webhook) throw new AppError(404, 'Webhook not found');

    const config = webhook.config as Record<string, unknown>;
    const url = config.url as string;

    // Anti-SSRF: el destino no puede apuntar a rangos privados/loopback/
    // link-local (metadata de la nube, servicios internos). Lanza 400 si no.
    await assertSafePublicUrl(url);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'webhook.test',
          timestamp: new Date().toISOString(),
          data: { message: 'Webhook de prueba desde Local B' },
        }),
        signal: AbortSignal.timeout(10000),
      });
      res.json({ success: response.ok, status: response.status });
    } catch {
      res.json({ success: false, status: 0, error: 'No se pudo conectar al endpoint' });
    }
  })
);

export { router as webhooksRouter };
