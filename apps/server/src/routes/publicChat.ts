import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  botId: z.string(),
  conversationId: z.string().optional(),
  contactName: z.string().max(100).optional(),
  contactPhone: z.string().max(30).optional(),
});

router.get('/bot/demo', async (_req, res) => {
  try {
    const bot = await prisma.bot.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        business: { select: { name: true } },
      },
    });

    if (!bot) {
      res.status(404).json({ error: 'No hay bots activos para demostración' });
      return;
    }

    res.json({
      id: bot.id,
      name: bot.name,
      businessName: bot.business.name,
      status: 'ACTIVE',
    });
  } catch (error) {
    console.error('Public demo bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/bot/:botId', async (req, res) => {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: req.params.botId },
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        business: { select: { id: true, name: true } },
      },
    });

    if (!bot || bot.status === 'DRAFT') {
      res.status(404).json({ error: 'Bot no encontrado' });
      return;
    }

    res.json({
      id: bot.id,
      name: bot.name,
      businessName: bot.business.name,
      status: bot.status,
    });
  } catch (error) {
    console.error('Public bot info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const data = chatSchema.parse(req.body);

    const bot = await prisma.bot.findUnique({
      where: { id: data.botId },
      select: { id: true, status: true, businessId: true },
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot no encontrado' });
      return;
    }

    if (bot.status !== 'ACTIVE') {
      res.json({
        text: 'El bot no está activo en este momento. Por favor, intentá más tarde.',
        intent: 'FAQ',
        actions: [],
        conversationId: data.conversationId || '',
      });
      return;
    }

    const response = await processMessage(bot.businessId, data.message, 'WEB', {
      conversationId: data.conversationId,
      botId: data.botId,
      contactName: data.contactName,
      contactPhone: data.contactPhone,
    });

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    console.error('Public chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as publicChatRouter };
