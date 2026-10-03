/**
 * Rutas de la integración con ManyChat.
 *   GET  /status            → estado de conexión (sin exponer la API key)
 *   POST /connect           → valida la API key y la guarda (cifrada)
 *   POST /disconnect        → borra la conexión
 *   POST /regenerate-token  → rota el token del webhook entrante
 *   POST /webhook/:businessId → endpoint PÚBLICO que recibe mensajes de ManyChat,
 *                               los pasa al chatbot y responde (Dynamic Block v2).
 * Conectar/desconectar/regenerar: solo ADMIN. El webhook es público pero
 * autenticado por un token compartido por negocio.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  getMcStatus,
  saveMcConfig,
  disconnectMc,
  verifyMcWebhookToken,
  regenerateMcWebhookToken,
} from '../services/manychat/config';
import { testApiKey } from '../services/manychat/client';
import { processMessage } from '../services/chatbot';

const router = Router();

const connectSchema = z.object({
  apiKey: z.string().min(1, 'La API key es obligatoria').trim(),
});

/**
 * Payload entrante de ManyChat. ManyChat arma el body de la "External Request",
 * así que aceptamos los nombres de campo más comunes y dejamos pasar el resto.
 * El mensaje del suscriptor puede venir como text / message / last_input_text.
 */
const webhookSchema = z
  .object({
    text: z.string().max(2000).optional(),
    message: z.string().max(2000).optional(),
    last_input_text: z.string().max(2000).optional(),
    subscriberId: z.string().max(120).optional(),
    subscriber_id: z.string().max(120).optional(),
    user_id: z.union([z.string().max(120), z.number()]).optional(),
    name: z.string().max(120).optional(),
    first_name: z.string().max(120).optional(),
    conversationId: z.string().max(120).optional(),
  })
  .passthrough();

/** Respuesta en formato Dynamic Block v2 que ManyChat renderiza al suscriptor. */
function dynamicBlock(text: string, conversationId?: string) {
  return {
    version: 'v2',
    content: { messages: [{ type: 'text', text }] },
    // Campo extra (ManyChat lo ignora en el render, pero las configuraciones
    // con "External Request" pueden mapearlo a un campo del suscriptor para
    // mantener la continuidad de la conversación en el próximo mensaje).
    ...(conversationId ? { conversationId } : {}),
  };
}

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getMcStatus(req.auth!.businessId));
  })
);

router.post(
  '/connect',
  requireAuth,
  requireRole('ADMIN'),
  validate(connectSchema),
  asyncHandler(async (req, res) => {
    const { apiKey } = req.body as z.infer<typeof connectSchema>;

    const valid = await testApiKey(apiKey);
    if (!valid) throw new AppError(400, 'La API key de ManyChat no es válida');

    const status = await saveMcConfig(req.auth!.businessId, { apiKey });
    res.json(status);
  })
);

router.post(
  '/disconnect',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await disconnectMc(req.auth!.businessId);
    res.json({ connected: false, enabled: false });
  })
);

router.post(
  '/regenerate-token',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const status = await regenerateMcWebhookToken(req.auth!.businessId).catch(() => null);
    if (!status) throw new AppError(400, 'Conectá ManyChat antes de regenerar el token');
    res.json(status);
  })
);

/**
 * Webhook entrante PÚBLICO: ManyChat lo llama cuando un suscriptor escribe.
 * No usa requireAuth; se autentica con el token compartido del negocio (header
 * `x-webhook-token` o query `?token=`), comparado de forma timing-safe.
 * Convierte a ManyChat en un canal real: el mensaje entra al mismo cerebro del
 * chatbot que el resto de los canales y la respuesta vuelve en Dynamic Block v2.
 */
router.post(
  '/webhook/:businessId',
  validate(webhookSchema),
  asyncHandler(async (req, res) => {
    const businessId = String(req.params.businessId);

    const headerToken = req.header('x-webhook-token') || undefined;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = headerToken || queryToken;

    const ok = await verifyMcWebhookToken(businessId, token);
    if (!ok) throw new AppError(401, 'Token de webhook inválido');

    const body = req.body as z.infer<typeof webhookSchema>;

    // El texto del suscriptor puede llegar con distintos nombres según cómo el
    // negocio arme la External Request en ManyChat.
    const rawText = body.text ?? body.message ?? body.last_input_text ?? '';
    const text = rawText.trim();

    // Sin texto (p. ej. el suscriptor mandó una imagen/sticker): respondemos
    // amablemente sin llamar a la IA, manteniendo el formato que ManyChat espera.
    if (!text) {
      res.json(dynamicBlock('¿Me lo escribís por texto? Así te puedo ayudar mejor. 🙂'));
      return;
    }

    const subscriberId = body.subscriberId ?? body.subscriber_id ?? (body.user_id != null ? String(body.user_id) : undefined);
    const contactName = body.name ?? body.first_name ?? (subscriberId ? `ManyChat ${subscriberId}` : undefined);

    try {
      const response = await processMessage(businessId, text, 'MESSENGER', {
        ...(body.conversationId ? { conversationId: body.conversationId } : {}),
        ...(contactName ? { contactName } : {}),
      });
      res.json(dynamicBlock(response.text, response.conversationId));
    } catch (err) {
      // Nunca devolvemos 500 al webhook (ManyChat lo marcaría como fallo y
      // reintentaría): respondemos con un mensaje de cortesía válido.
      console.error('Error procesando webhook de ManyChat:', err);
      res.json(dynamicBlock('Estamos con un inconveniente técnico. Probá de nuevo en un ratito. 🙏'));
    }
  })
);

export { router as manychatRouter };
