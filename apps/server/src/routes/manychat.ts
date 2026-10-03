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
import { cache, cacheKey } from '../lib/cache';

const router = Router();

const connectSchema = z.object({
  apiKey: z.string().min(1, 'La API key es obligatoria').trim(),
});

/**
 * Payload entrante de ManyChat. ManyChat arma el body de la "External Request",
 * así que aceptamos los nombres de campo más comunes y toleramos null/numéricos
 * (ManyChat suele mandarlos). Las claves desconocidas se descartan (strip). El
 * mensaje del suscriptor puede venir como text / message / last_input_text.
 */
const webhookSchema = z.object({
  text: z.string().max(4000).nullish(),
  message: z.string().max(4000).nullish(),
  last_input_text: z.string().max(4000).nullish(),
  subscriberId: z.union([z.string().max(120), z.number()]).nullish(),
  subscriber_id: z.union([z.string().max(120), z.number()]).nullish(),
  user_id: z.union([z.string().max(120), z.number()]).nullish(),
  name: z.string().max(200).nullish(),
  first_name: z.string().max(200).nullish(),
  conversationId: z.string().max(120).nullish(),
});

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

// Rate limit propio del webhook (best-effort, in-memory, ventana de 1 min). Va
// aparte del limitador global por IP (que no sirve acá: ManyChat llama desde IPs
// compartidas por todos los negocios). Topeamos por negocio y por suscriptor
// porque cada mensaje dispara la IA (costo) y escribe en la base.
const WH_WINDOW_MS = 60_000;
const WH_MAX_PER_BUSINESS = 120;
const WH_MAX_PER_SUBSCRIBER = 15;

/** Devuelve true si hay que frenar (se responde cortesía, nunca 429 a ManyChat). */
function webhookRateLimited(businessId: string, subscriberId?: string): boolean {
  const minute = Math.floor(Date.now() / WH_WINDOW_MS);
  const bKey = cacheKey(businessId, 'mc-wh', String(minute));
  const bCount = cache.get<number>(bKey) ?? 0;
  if (bCount >= WH_MAX_PER_BUSINESS) return true;

  if (subscriberId) {
    const sKey = cacheKey(businessId, 'mc-wh-sub', subscriberId, String(minute));
    const sCount = cache.get<number>(sKey) ?? 0;
    if (sCount >= WH_MAX_PER_SUBSCRIBER) return true;
    cache.set(sKey, sCount + 1, WH_WINDOW_MS);
  }
  cache.set(bKey, bCount + 1, WH_WINDOW_MS);
  return false;
}

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = await getMcStatus(req.auth!.businessId);
    // El webhookToken es un secreto con capacidad (disparar el bot / costo de
    // IA): solo lo ve un ADMIN, no cualquier rol del negocio.
    if (req.auth!.role !== 'ADMIN') delete status.webhookToken;
    res.json(status);
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
    // Devuelve null solo si no está conectado → 400. Un error real de DB se
    // propaga al errorHandler (500) en vez de quedar enmascarado como 400.
    const status = await regenerateMcWebhookToken(req.auth!.businessId);
    if (!status) throw new AppError(400, 'Conectá ManyChat antes de regenerar el token');
    res.json(status);
  })
);

/**
 * Webhook entrante PÚBLICO: ManyChat lo llama cuando un suscriptor escribe.
 * No usa requireAuth; se autentica con el token compartido del negocio en el
 * header `x-webhook-token` (comparado de forma timing-safe). Se usa header y no
 * query para que el secreto no termine en los access logs ni en la auditoría.
 * Convierte a ManyChat en un canal real: el mensaje entra al mismo cerebro del
 * chatbot que el resto de los canales y la respuesta vuelve en Dynamic Block v2.
 * Nunca responde 400/429/500 a ManyChat (lo reintentaría): ante cualquier
 * problema devuelve un Dynamic Block de cortesía.
 */
router.post(
  '/webhook/:businessId',
  asyncHandler(async (req, res) => {
    const businessId = String(req.params.businessId);

    // 1) Autenticación ANTES de parsear el body (no filtramos el esquema a un
    //    llamador no autenticado).
    const token = req.header('x-webhook-token') || undefined;
    const ok = await verifyMcWebhookToken(businessId, token);
    if (!ok) throw new AppError(401, 'Token de webhook inválido');

    // 2) Parseo tolerante: si ManyChat manda algo inesperado, no devolvemos 400
    //    (lo reintentaría) — respondemos cortesía.
    const parsed = webhookSchema.safeParse(req.body ?? {});
    const body = parsed.success ? parsed.data : {};

    const rawText = body.text ?? body.message ?? body.last_input_text ?? '';
    const text = String(rawText).trim();

    const subRaw = body.subscriberId ?? body.subscriber_id ?? body.user_id;
    const subscriberId = subRaw != null ? String(subRaw) : undefined;

    // Sin texto (p. ej. el suscriptor mandó una imagen/sticker): respondemos
    // amablemente sin llamar a la IA, manteniendo el formato que ManyChat espera.
    if (!text) {
      res.json(dynamicBlock('¿Me lo escribís por texto? Así te puedo ayudar mejor. 🙂'));
      return;
    }

    // 3) Rate limit propio por negocio/suscriptor (protege el costo de IA).
    if (webhookRateLimited(businessId, subscriberId)) {
      res.json(dynamicBlock('Estamos recibiendo muchos mensajes. Probá de nuevo en un minuto. 🙏'));
      return;
    }

    const contactName = body.name ?? body.first_name ?? (subscriberId ? `ManyChat ${subscriberId}` : undefined);

    try {
      const response = await processMessage(businessId, text, 'MESSENGER', {
        ...(body.conversationId ? { conversationId: String(body.conversationId) } : {}),
        ...(subscriberId ? { subscriberId } : {}),
        ...(contactName ? { contactName: String(contactName) } : {}),
      });
      res.json(dynamicBlock(response.text, response.conversationId));
    } catch (err) {
      // Nunca devolvemos 500 al webhook. Logueamos acotado (sin payload del
      // cliente ni de la IA) para no filtrar datos sensibles.
      console.error('Error en webhook de ManyChat', { businessId, error: (err as Error).message });
      res.json(dynamicBlock('Estamos con un inconveniente técnico. Probá de nuevo en un ratito. 🙏'));
    }
  })
);

export { router as manychatRouter };
