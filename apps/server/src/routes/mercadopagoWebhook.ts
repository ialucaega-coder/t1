/**
 * Webhook PÚBLICO de MercadoPago (confirmación de pago).
 *   POST /api/mercadopago/webhook/:businessId   (webhooks v1: { type, data: { id } })
 *   GET  /api/mercadopago/webhook/:businessId   (IPN legado: ?topic=payment&id=...)
 *
 * Es la `notification_url` que se envía al crear cada link de cobro
 * (services/mercadopago/payments.ts#buildNotificationUrl).
 *
 * Seguridad:
 *  - NO se confía en el cuerpo: de ahí solo sale el id numérico del pago. El pago
 *    se consulta a la API de MercadoPago con el access token de ESE negocio; si no
 *    lo reconoce, no se hace nada. Esa consulta es la verificación anti-falsificación.
 *  - La firma `x-signature` se valida SOLO si el negocio configuró una clave
 *    secreta de webhook; si no la tiene, alcanza con la consulta a la API.
 *  - Con clave configurada, la firma se ata al MISMO id de pago que se procesa
 *    (el `data.id` de la query firmada tiene que coincidir con el del cuerpo).
 *  - Idempotente por id de pago (los reintentos de MercadoPago no duplican).
 *  - Cuerpo acotado a 100 KB (prefijo en middleware/bodyLimits.ts).
 *  - Rate limit pensado para que un tercero NO pueda dejar sin servicio a un
 *    negocio (el businessId no es secreto): tope por IP holgado antes de tocar la
 *    base, intentos inválidos (firma mala, pago no reconocido) contados aparte por
 *    IP+negocio, y el contador del negocio solo cuenta avisos ya verificados.
 *
 * Respuestas: 200 siempre que la notificación sea válida (también cuando se
 * ignora: pago pendiente, no reconocido, etc.); 400 si el cuerpo es inválido;
 * 401 si la firma no valida; 429/503 solo cuando conviene que MercadoPago
 * reintente (rate limit, fallo transitorio al consultar la API / la base, o no
 * poder descifrar las credenciales del negocio). Un negocio sin MercadoPago
 * conectado (o deshabilitado) se responde 200: no hay nada que reintentar.
 */
import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validateRequestSize } from '../middleware/security';
import { PUBLIC_BODY_LIMIT_BYTES } from '../middleware/bodyLimits';
import { loadMpConfigForWebhook } from '../services/mercadopago/config';
import {
  processPaymentNotification,
  verifyMpSignature,
  SUSPICIOUS_REASONS,
} from '../services/mercadopago/payments';
import { cacheKey } from '../lib/cache';
import { sharedIncr, sharedGet } from '../lib/sharedState';

const router = Router();

const WH_WINDOW_MS = 60_000;
/** Avisos verificados por negocio y minuto (seguro contra bucles; solo cuenta avisos reales). */
export const WH_MAX_PER_BUSINESS = 300;
/** Requests por IP y minuto, ANTES de tocar la base. Holgado: MercadoPago llama desde IPs compartidas. */
export const WH_MAX_PER_IP = 600;
/** Intentos inválidos (firma mala, pago no reconocido) por IP+negocio y minuto. */
export const WH_MAX_BAD_PER_IP_BUSINESS = 30;

const BUSINESS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PAYMENT_ID_RE = /^\d{1,20}$/;

router.use(validateRequestSize({ maxBodyBytes: PUBLIC_BODY_LIMIT_BYTES }));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * Extrae tema e id de pago de cualquiera de los formatos (webhook v1 / IPN). Solo
 * lee, no confía. `queryId` es el `data.id` de la URL (el que MercadoPago firma) y
 * el del cuerpo es el otro candidato; si vienen los dos tienen que coincidir.
 */
function extractNotification(req: Request): {
  topic?: string;
  paymentId?: string;
  queryId?: string;
  mismatch: boolean;
} {
  const body = isRecord(req.body) ? req.body : {};
  const query = req.query as Record<string, unknown>;
  const data = isRecord(body.data) ? body.data : {};

  const topic = (str(body.type) ?? str(body.topic) ?? str(query.type) ?? str(query.topic))?.toLowerCase();

  const queryId = str(query['data.id']);
  let bodyId = str(data.id);
  if (!bodyId && !queryId && (topic === 'payment' || topic === undefined)) {
    // IPN: ?id=123 o `resource` con la URL del pago.
    bodyId = str(query.id) ?? str(body.id);
    const resource = str(body.resource) ?? str(query.resource);
    if (!bodyId && resource) {
      bodyId = /\/payments\/(\d+)\/?$/.exec(resource)?.[1] ?? (/^\d+$/.test(resource) ? resource : undefined);
    }
  }
  const mismatch = Boolean(queryId && bodyId && queryId.toLowerCase() !== bodyId.toLowerCase());
  return { topic, paymentId: bodyId ?? queryId, queryId, mismatch };
}

const minuteOf = () => String(Math.floor(Date.now() / WH_WINDOW_MS));

const handle = asyncHandler(async (req, res) => {
  const businessId = String(req.params.businessId ?? '');
  if (!BUSINESS_ID_RE.test(businessId)) {
    res.status(400).json({ error: 'Negocio inválido en la URL del webhook' });
    return;
  }

  // 1) Tope por IP ANTES de tocar la base (el businessId de la URL no es secreto).
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if ((await sharedIncr(`mp-wh-ip:${ip}:${minuteOf()}`, WH_WINDOW_MS)) > WH_MAX_PER_IP) {
    res.status(429).json({ error: 'Demasiadas notificaciones' });
    return;
  }
  // Intentos inválidos de esta IP contra este negocio: contador aparte del del
  // negocio, así un atacante se bloquea a sí mismo sin afectar los avisos reales.
  const badKey = cacheKey(businessId, 'mp-wh-bad', ip, minuteOf());
  if (((await sharedGet<number>(badKey)) ?? 0) >= WH_MAX_BAD_PER_IP_BUSINESS) {
    res.status(429).json({ error: 'Demasiados intentos inválidos' });
    return;
  }
  const countBad = () => sharedIncr(badKey, WH_WINDOW_MS);

  const { topic, paymentId, queryId, mismatch } = extractNotification(req);

  // Temas que no son pagos (merchant_order, etc.): se reconocen y se ignoran.
  if (topic && topic !== 'payment') {
    res.status(200).json({ received: true });
    return;
  }
  if (!paymentId || !PAYMENT_ID_RE.test(paymentId)) {
    res.status(400).json({ error: 'Notificación sin un id de pago válido' });
    return;
  }
  // El id de la URL (el firmado) y el del cuerpo no pueden discrepar.
  if (mismatch) {
    await countBad();
    res.status(400).json({ error: 'El id de pago de la URL y el del cuerpo no coinciden' });
    return;
  }

  try {
    const cfg = await loadMpConfigForWebhook(businessId);
    if (!cfg) {
      // Negocio inexistente o sin MercadoPago conectado: no hay nada que reintentar
      // y no revelamos qué negocios existen. No cuenta para ningún tope.
      res.status(200).json({ received: true });
      return;
    }
    if (!cfg.enabled) {
      console.warn('[mercadopago] aviso de pago con MercadoPago deshabilitado: se ignora', { businessId, paymentId });
      res.status(200).json({ received: true });
      return;
    }

    // Firma: solo si el negocio ya configuró su clave secreta de webhook. Se valida
    // contra el `data.id` de la URL, que es el MISMO id que se procesa (si falta, no
    // hay forma de atar la firma al pago: se rechaza).
    if (cfg.webhookSecret) {
      const ok =
        queryId !== undefined &&
        verifyMpSignature({
          secret: cfg.webhookSecret,
          signatureHeader: req.header('x-signature') || undefined,
          requestId: req.header('x-request-id') || undefined,
          dataId: queryId,
        });
      if (!ok) {
        await countBad();
        console.warn('[mercadopago] webhook con firma inválida', { businessId });
        res.status(401).json({ error: 'Firma inválida' });
        return;
      }
    }

    // El tope por negocio se cuenta DESPUÉS de verificar firma y de que MercadoPago
    // reconozca el pago (ver `onVerified`).
    const outcome = await processPaymentNotification(
      businessId,
      cfg,
      paymentId,
      async () => (await sharedIncr(cacheKey(businessId, 'mp-wh', minuteOf()), WH_WINDOW_MS)) <= WH_MAX_PER_BUSINESS,
    );

    if (outcome.result === 'rate_limited') {
      res.status(429).json({ error: 'Demasiadas notificaciones' });
      return;
    }
    if (outcome.result === 'ignored' && SUSPICIOUS_REASONS.has(outcome.reason)) await countBad();

    console.log('[mercadopago] webhook procesado', {
      businessId,
      paymentId,
      result: outcome.result,
      ...(outcome.result === 'ignored' ? { reason: outcome.reason } : {}),
    });
    res.status(200).json({ received: true });
  } catch (err) {
    // Fallo transitorio (API de MercadoPago caída, base de datos) o credenciales
    // que no se pueden descifrar: 503 para que MercadoPago reintente y el pago no
    // se pierda en silencio. Sin payload ni token en el log.
    console.error('[mercadopago] error procesando webhook (503: MercadoPago reintenta)', {
      businessId,
      paymentId,
      error: (err as Error).message,
    });
    res.status(503).json({ error: 'No se pudo procesar la notificación, reintentá' });
  }
});

router.post('/:businessId', handle);
router.get('/:businessId', handle);

// La URL sin negocio no sirve (no sabemos de qué cuenta consultar el pago).
router.all('/', (_req, res) => {
  res.status(400).json({ error: 'Falta el negocio en la URL: /api/mercadopago/webhook/:businessId' });
});

export { router as mercadopagoWebhookRouter };
