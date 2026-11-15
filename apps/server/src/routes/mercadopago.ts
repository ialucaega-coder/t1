/**
 * Rutas de la integración con MercadoPago (pagos).
 *   GET  /status        → estado de conexión (sin exponer el access token)
 *   POST /connect       → valida el access token y lo guarda (cifrado) + moneda
 *   POST /disconnect    → borra la conexión
 *   POST /payment-link  → genera un link de cobro (preferencia Checkout Pro) con
 *                         external_reference + notification_url propios
 *   POST /webhook-secret → guarda/quita la clave secreta del webhook (firma x-signature)
 * El aviso de pago de MercadoPago entra por routes/mercadopagoWebhook.ts (público).
 * Conectar/desconectar: solo ADMIN. Generar link: cualquier usuario autenticado.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, requireStaff } from '../middleware/auth';
import { requireCapability } from '../middleware/capability';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getMpStatus, saveMpConfig, disconnectMp, loadMpConfig } from '../services/mercadopago/config';
import { testAccessToken, createPaymentPreference } from '../services/mercadopago/client';
import { buildExternalReference, buildNotificationUrl, recordCobro } from '../services/mercadopago/payments';

const router = Router();

const connectSchema = z.object({
  accessToken: z.string().min(1, 'El access token es obligatorio').trim(),
  currency: z.string().trim().length(3).optional(),
  /** Clave secreta del webhook (opcional). Si se guarda, el webhook exige x-signature válida. */
  webhookSecret: z.string().trim().min(1).max(200).optional(),
});

const webhookSecretSchema = z.object({
  /** null o vacío = quitar la clave. */
  webhookSecret: z.string().trim().max(200).nullable(),
});

const paymentLinkSchema = z.object({
  amount: z.number().positive('El monto debe ser mayor a 0'),
  description: z.string().min(1).max(200).trim(),
  currency: z.string().trim().length(3).optional(),
});

router.get(
  '/status',
  requireAuth,
  requireStaff,
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
    const { accessToken, currency, webhookSecret } = req.body as z.infer<typeof connectSchema>;

    const valid = await testAccessToken(accessToken);
    if (!valid) throw new AppError(400, 'El access token de MercadoPago no es válido');

    const status = await saveMpConfig(req.auth!.businessId, {
      accessToken,
      currency: currency?.toUpperCase(),
      ...(webhookSecret ? { webhookSecret } : {}),
    });
    res.json(status);
  })
);

router.post(
  '/webhook-secret',
  requireAuth,
  requireRole('ADMIN'),
  validate(webhookSecretSchema),
  asyncHandler(async (req, res) => {
    const { webhookSecret } = req.body as z.infer<typeof webhookSecretSchema>;
    const current = await getMpStatus(req.auth!.businessId);
    if (!current.connected) throw new AppError(400, 'Conectá MercadoPago primero');
    res.json(await saveMpConfig(req.auth!.businessId, { webhookSecret: webhookSecret || null }));
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

// Genera cobros en la cuenta de MercadoPago del negocio y crea una fila por cobro:
// solo staff con la capacidad de ventas (un CLIENT logueado no), con tope por negocio.
router.post(
  '/payment-link',
  requireAuth,
  requireStaff,
  requireCapability('sales'),
  tenantRateLimit({ name: 'mp-payment-link', max: 30 }),
  validate(paymentLinkSchema),
  asyncHandler(async (req, res) => {
    const { amount, description, currency } = req.body as z.infer<typeof paymentLinkSchema>;
    const cfg = await loadMpConfig(req.auth!.businessId);
    if (!cfg || !cfg.enabled) throw new AppError(400, 'Conectá MercadoPago primero');

    const businessId = req.auth!.businessId;
    const finalCurrency = (currency?.toUpperCase()) || cfg.currency;
    // Referencia propia (negocio + id único del cobro) y URL pública del webhook:
    // así MercadoPago nos avisa cuando el cliente paga (ver mercadopagoWebhook.ts).
    const externalReference = buildExternalReference(businessId);
    const notificationUrl = buildNotificationUrl(businessId);

    const pref = await createPaymentPreference(cfg.accessToken, {
      title: description,
      amount,
      currency: finalCurrency,
      externalReference,
      notificationUrl,
    });
    // Guardamos el cobro para reconocerlo cuando llegue el pago.
    await recordCobro(businessId, externalReference, {
      preferenceId: pref.id,
      amount,
      currency: finalCurrency,
      description,
    });
    // `autoRegister` indica si el pago se va a registrar solo (hay URL pública
    // para el aviso de MercadoPago); en local/sin API_PUBLIC_URL no.
    res.json({ url: pref.initPoint, id: pref.id, autoRegister: Boolean(notificationUrl) });
  })
);

export { router as mercadopagoRouter };
