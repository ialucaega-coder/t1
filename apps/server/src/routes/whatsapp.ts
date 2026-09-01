import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { sendMessage, validateWebhookSignature, isConfigured } from '../services/whatsapp/client';
import { requireAuth } from '../middleware/auth';

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

    if (process.env.NODE_ENV === 'production' && signature) {
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
      where: { channel: 'WHATSAPP', status: 'ACTIVE' },
      include: { business: { select: { id: true } } },
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
  asyncHandler(async (req: Request, res: Response) => {
    const { to, message } = req.body;
    if (!to || !message) {
      res.status(400).json({ error: 'Se requiere "to" y "message"' });
      return;
    }

    const sid = await sendMessage(to, message);
    res.json({ success: true, sid });
  })
);

export const whatsappRouter = router;
