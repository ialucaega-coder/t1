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
  downloadTwilioImagesAsBase64,
} from '../services/whatsapp/client';
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

    if (process.env.NODE_ENV === 'production') {
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

    // Parseamos las imágenes adjuntas (Twilio manda NumMedia + MediaUrl0..N con
    // sus MediaContentType0..N). El gate por superpoder "Oído y vista" está en
    // processMessage: si el negocio no lo tiene activo, se ignoran.
    const images = parseTwilioImages(req.body);

    // Si el mensaje viene solo con imagen y sin texto, usamos un texto por
    // defecto para no romper la validación de processMessage.
    const rawBody = req.body.Body || '';
    const body = rawBody || (images.length ? '(imagen adjunta)' : '');

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

    // Visión por WhatsApp: las MediaUrl de Twilio están tras Basic auth, así que
    // Anthropic no puede bajarlas por URL. Solo si el negocio tiene activo "Oído
    // y vista" las descargamos con nuestras credenciales y las convertimos a
    // base64 (evita el costo de descargar cuando el superpoder está apagado).
    let visionImages = images;
    if (images.length) {
      const activeSuperpowers = await getActiveSuperpowers(businessId);
      visionImages = activeSuperpowers.has('Oído y vista')
        ? await downloadTwilioImagesAsBase64(images)
        : [];
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

    try {
      const result = await processMessage(businessId, body, 'WHATSAPP', {
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
