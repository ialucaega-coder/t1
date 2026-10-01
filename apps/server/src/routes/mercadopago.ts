/**
 * Rutas de la integración con MercadoPago (pagos).
 *   GET  /status        → estado de conexión (sin exponer el access token)
 *   POST /connect       → valida el access token y lo guarda (cifrado) + moneda
 *   POST /disconnect    → borra la conexión
 *   POST /payment-link  → genera un link de cobro (preferencia Checkout Pro)
 * Conectar/desconectar: solo ADMIN. Generar link: cualquier usuario autenticado.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getMpStatus, saveMpConfig, disconnectMp, loadMpConfig } from '../services/mercadopago/config';
import { testAccessToken, createPaymentPreference } from '../services/mercadopago/client';

const router = Router();

const connectSchema = z.object({
  accessToken: z.string().min(1, 'El access token es obligatorio').trim(),
  currency: z.string().trim().length(3).optional(),
});

const paymentLinkSchema = z.object({
  amount: z.number().positive('El monto debe ser mayor a 0'),
  description: z.string().min(1).max(200).trim(),
  currency: z.string().trim().length(3).optional(),
});

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getMpStatus(req.auth!.businessId));
  })
);

router.post(
  '/connect',
  requireAuth,
  requireRole('ADMIN'),
  validate(connectSchema),
  asyncHandler(async (req, res) => {
    const { accessToken, currency } = req.body as z.infer<typeof connectSchema>;

    const valid = await testAccessToken(accessToken);
    if (!valid) throw new AppError(400, 'El access token de MercadoPago no es válido');

    const status = await saveMpConfig(req.auth!.businessId, {
      accessToken,
      currency: currency?.toUpperCase(),
    });
    res.json(status);
  })
);

router.post(
  '/disconnect',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await disconnectMp(req.auth!.businessId);
    res.json({ connected: false, enabled: false, currency: 'ARS' });
  })
);

router.post(
  '/payment-link',
  requireAuth,
  validate(paymentLinkSchema),
  asyncHandler(async (req, res) => {
    const { amount, description, currency } = req.body as z.infer<typeof paymentLinkSchema>;
    const cfg = await loadMpConfig(req.auth!.businessId);
    if (!cfg || !cfg.enabled) throw new AppError(400, 'Conectá MercadoPago primero');

    const pref = await createPaymentPreference(cfg.accessToken, {
      title: description,
      amount,
      currency: (currency?.toUpperCase()) || cfg.currency,
    });
    res.json({ url: pref.initPoint, id: pref.id });
  })
);

export { router as mercadopagoRouter };
