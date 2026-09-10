import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { sendMessage, validateWebhookSignature, isConfigured } from '../services/whatsapp/client';
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
    const body = req.body.Body || '';
    const profileName = req.body.ProfileName || '';

    if (!from || !body) {
      res.status(200).send('OK');
      return;
    }

    const bot = await prisma.bot.findFirst({
      where: {
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        business: { phone: { not: null } },
      },
      include: { business: { select: { id: true, phone: true } } },
    });

    if (!bot) {
      res.status(200).send('OK');
      return;
    }

    const businessId = bot.businessId;

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        businessId,
        botId: bot.id,
        channel: 'WHATSAPP',
        contactPhone: from,
        status: 'OPEN',
      },
      orderBy: { updatedAt: 'desc' },
    });

    try {
      const result = await processMessage(businessId, body, 'WHATSAPP', {
        conversationId: existingConversation?.id,
        botId: bot.id,
        contactName: profileName,
        contactPhone: from,
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
