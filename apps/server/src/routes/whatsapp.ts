import { Router, type Request, type Response } from 'express';
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
import { requireAuth } from '../middleware/auth';

const sendMessageSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1).max(5000),
});

const router = Router();

router.get('/status', requireAuth, (_req: Request, res: Response) => {
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

    // Todo el post-procesamiento va dentro de try/catch para garantizar que el
    // webhook SIEMPRE responda 200 (si una consulta a DB o una descarga lanza,
    // Twilio no debe recibir un 500 y reintentar, duplicando el mensaje).
    try {
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
          status: 'OPEN',
        },
        orderBy: { updatedAt: 'desc' },
      });

      const result = await processMessage(businessId, finalBody, 'WHATSAPP', {
        conversationId: existingConversation?.id,
        botId,
        contactName: profileName,
        contactPhone: from,
        ...(visionImages.length ? { images: visionImages } : {}),
      });

      await sendMessage(from, result.text);
    } catch (error) {
      console.error('WhatsApp webhook error:', error);
    }

    res.status(200).send('OK');
  })
);

router.post(
  '/send',
  requireAuth,
  validate(sendMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { to, message } = req.body;

    const sid = await sendMessage(to, message);
    res.json({ success: true, sid });
  })
);

export const whatsappRouter = router;
