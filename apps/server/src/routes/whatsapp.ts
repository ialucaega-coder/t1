import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { processMessage, getActiveSuperpowers } from '../services/chatbot';
import {
  sendMessage,
  validateWebhookSignature,
  isConfigured,
  resolveBusinessByNumber,
  parseTwilioImages,
  parseTwilioAudio,
  downloadTwilioImagesAsBase64,
  getTwilioAuthHeader,
  isTwilioMediaUrl,
} from '../services/whatsapp/client';
import { transcribeAudioFromUrl } from '../services/ai/transcription';
import { parseWhatsAppReferral } from '../services/whatsapp/attribution';
import { requireAuth, requireStaff } from '../middleware/auth';
import { requireCapability } from '../middleware/capability';
import { defineQueue, enqueue } from '../lib/queue';
import { runInbound, INBOUND_RETRY } from '../services/channels/inboundRetry';

const sendMessageSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1).max(5000),
});

const router = Router();

/** Cola de mensajes entrantes de WhatsApp (ver el webhook más abajo). */
const WA_INBOUND_QUEUE = 'whatsapp-inbound';

/** Datos serializables del mensaje entrante (viajan por Redis: sin secretos). */
interface WhatsAppInboundJob {
  businessId: string;
  botId: string;
  from: string;
  to: string;
  profileName: string;
  rawBody: string;
  body: string;
  images: ReturnType<typeof parseTwilioImages>;
  audios: ReturnType<typeof parseTwilioAudio>;
  attribution?: NonNullable<ReturnType<typeof parseWhatsAppReferral>>;
  /** MessageSid de Twilio: marca el mensaje USER guardado para que un reintento no lo duplique. */
  messageSid?: string;
}

/**
 * Procesa un mensaje entrante: adjuntos (visión / transcripción), conversación,
 * respuesta del bot y envío DESDE el número del negocio.
 *
 * Reintentos (ver services/channels/inboundRetry.ts): un fallo ANTES de guardar
 * nada se relanza y la cola reintenta (con backoff); un fallo con mensajes ya
 * guardados, o al ENVIAR la respuesta, solo se loguea (reintentar duplicaría).
 * El dedupe por MessageSid evita procesar dos veces el mismo mensaje.
 */
async function processWhatsAppInbound(job: WhatsAppInboundJob): Promise<void> {
  const { businessId, botId, from, to, profileName, rawBody, body, images, audios, attribution, messageSid } = job;
  await runInbound('WhatsApp webhook error', { businessId, contact: from, externalId: messageSid }, async (phase) => {
    // "Oído y vista": consultamos el superpoder una sola vez si hay adjuntos.
    const hasAttachments = images.length > 0 || audios.length > 0;
    const oidoYVista = hasAttachments
      ? (await getActiveSuperpowers(businessId)).has('Oído y vista')
      : false;

    // Visión: las MediaUrl de Twilio están tras Basic auth, así que Anthropic no
    // puede bajarlas por URL. Solo si "Oído y vista" está activo las bajamos con
    // credenciales y las convertimos a base64.
    let visionImages = images;
    if (images.length) {
      visionImages = oidoYVista ? await downloadTwilioImagesAsBase64(images) : [];
    }

    // Audio: transcribimos las notas de voz con Whisper y usamos el texto como
    // mensaje. Requiere "Oído y vista" y OPENAI_API_KEY (si falta, degrada).
    let finalBody = body;
    if (audios.length && oidoYVista) {
      const authHeader = getTwilioAuthHeader();
      for (const audio of audios) {
        if (!isTwilioMediaUrl(audio.url)) continue; // anti-SSRF: no mandar creds a otros hosts
        const transcript = await transcribeAudioFromUrl(audio.url, {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          mediaType: audio.mediaType,
        });
        if (transcript) {
          finalBody = rawBody ? `${rawBody}\n${transcript}` : transcript;
          break;
        }
      }
    }

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        businessId,
        botId,
        channel: 'WHATSAPP',
        contactPhone: from,
        status: { in: ['OPEN', 'HANDOFF'] }, // una derivada a humano sigue siendo la misma charla
      },
      orderBy: { updatedAt: 'desc' },
    });

    const result = await processMessage(businessId, finalBody, 'WHATSAPP', {
      conversationId: existingConversation?.id,
      botId,
      contactName: profileName,
      contactPhone: from,
      ...(visionImages.length ? { images: visionImages } : {}),
      ...(attribution ? { attribution } : {}),
      ...(messageSid ? { externalId: messageSid } : {}),
    });

    // A partir de acá la respuesta ya está guardada: un fallo del envío NO se reintenta.
    phase.processed();

    // Un humano tomó la conversación: el mensaje ya se guardó, el bot no contesta.
    if (result.botPaused) return;

    // Responde DESDE el número del negocio (el `To` al que escribió el
    // cliente), no desde el número global, para respetar el multi-tenant.
    await sendMessage(from, result.text, to.replace('whatsapp:', '').trim() || undefined);
  });
}

defineQueue<WhatsAppInboundJob>(WA_INBOUND_QUEUE, processWhatsAppInbound, { concurrency: 10 });


// Twilio postea el webhook entrante como application/x-www-form-urlencoded (no
// JSON), así que este router necesita su propio parser: el global solo tiene
// express.json(), con lo que el body llegaría vacío y From/To/Body/firma no
// resolverían. Mismo patrón que el router de voz.
router.use(express.urlencoded({ extended: false }));

router.get('/status', requireAuth, requireStaff, requireCapability('channels'), (_req: Request, res: Response) => {
  res.json({ configured: isConfigured() });
});

router.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers['x-twilio-signature'] as string;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const fullUrl = `${protocol}://${req.get('host')}${req.originalUrl}`;

    // Firma segura por defecto: validamos siempre salvo opt-in explícito para
    // desarrollo local (SKIP_WEBHOOK_SIGNATURE_VALIDATION=true).
    if (process.env.SKIP_WEBHOOK_SIGNATURE_VALIDATION !== 'true') {
      if (!signature) {
        res.status(403).send('Missing signature');
        return;
      }
      const valid = validateWebhookSignature(fullUrl, req.body, signature);
      if (!valid) {
        res.status(403).send('Invalid signature');
        return;
      }
    }

    const from = (req.body.From || '').replace('whatsapp:', '');
    const to = req.body.To || '';
    const profileName = req.body.ProfileName || '';

    // Parseamos imágenes y audios adjuntos (Twilio manda NumMedia + MediaUrl0..N
    // con sus MediaContentType0..N). El gate por superpoder "Oído y vista" se
    // aplica más abajo (imágenes) y en processMessage.
    const images = parseTwilioImages(req.body);
    const audios = parseTwilioAudio(req.body);

    // Si el mensaje viene solo con adjunto y sin texto, usamos un placeholder para
    // no romper la validación (el audio puede reemplazarlo con su transcripción).
    const rawBody = req.body.Body || '';
    const body =
      rawBody || (images.length ? '(imagen adjunta)' : audios.length ? '(nota de voz)' : '');

    if (!from || !body) {
      res.status(200).send('OK');
      return;
    }

    // Resolución multi-tenant: buscamos el bot de WhatsApp del negocio dueño del
    // número de DESTINO (To), replicando el patrón del canal de voz. Si no se
    // resuelve, respondemos 200 OK sin procesar (igual que antes).
    const target = await resolveBusinessByNumber(to);
    if (!target) {
      res.status(200).send('OK');
      return;
    }

    const { businessId, botId } = target;

    // El procesamiento (LLM + respuesta por la API de Twilio) va a una COLA: el
    // webhook responde 200 enseguida (Twilio corta a ~15 s y reintenta) y un
    // reintento del mismo MessageSid no duplica mensaje ni costo de IA (dedupe por
    // jobId). Sin Redis se ejecuta inline, igual que antes.
    const messageSid = String(req.body.MessageSid || req.body.SmsMessageSid || '').trim();
    await enqueue<WhatsAppInboundJob>(
      WA_INBOUND_QUEUE,
      {
        businessId,
        botId,
        from,
        to,
        profileName,
        rawBody,
        body,
        images,
        audios,
        // Atribución Click-to-WhatsApp: se parsea acá (necesita el body crudo de
        // Twilio) y viaja ya normalizada.
        attribution: parseWhatsAppReferral(req.body) ?? undefined,
        messageSid: messageSid || undefined,
      },
      { ...(messageSid ? { jobId: `wa_${messageSid}` } : {}), ...INBOUND_RETRY },
    );

    res.status(200).send('OK');
  })
);

router.post(
  '/send',
  requireAuth,
  requireStaff,
  // Mandar WhatsApp a cualquier número desde el número del negocio: solo quien tiene
  // el módulo de Canales (el que usa el panel en Conexiones), no cualquier staff.
  requireCapability('channels'),
  validate(sendMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { to, message } = req.body;

    // Envía desde el número dedicado del negocio (fallback al global si no tiene).
    const business = await prisma.business.findUnique({
      where: { id: req.auth!.businessId },
      select: { whatsappNumber: true },
    });

    const sid = await sendMessage(to, message, business?.whatsappNumber || undefined);
    res.json({ success: true, sid });
  })
);

export const whatsappRouter = router;
