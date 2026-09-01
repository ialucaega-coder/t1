/**
 * Rutas de IA: chat del bot, generación de prompts y listado de proveedores.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { listAvailableProviders, getDefaultAIProvider } from '../services/ai';

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1),
  channel: z.enum(['WEB', 'TELEGRAM', 'WHATSAPP', 'VOICE']).default('WEB'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .optional(),
  clientId: z.string().optional(),
  conversationId: z.string().optional(),
  botId: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
});

/**
 * POST /api/ai/chat
 * Procesa un mensaje de un cliente y devuelve la respuesta del bot.
 * Requiere autenticación: usa el businessId del token (multi-tenant).
 */
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const data = chatSchema.parse(req.body);
    const response = await processMessage(req.auth!.businessId, data.message, data.channel, {
      history: data.history,
      clientId: data.clientId,
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
    console.error('AI chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const generatePromptSchema = z.object({
  tone: z.enum(['formal', 'amigable', 'directo']).default('amigable'),
});

/**
 * POST /api/ai/generate-prompt
 * Genera (o regenera) un prompt de sistema a partir de los datos reales
 * del negocio (nombre, servicios, etc.), listo para copiar/pegar o guardar.
 */
router.post('/generate-prompt', requireAuth, async (req, res) => {
  try {
    const { tone } = generatePromptSchema.parse(req.body);
    const businessId = req.auth!.businessId;

    const [business, services] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.service.findMany({
        where: { businessId, isActive: true },
        select: { name: true, price: true, duration: true, currency: true },
        take: 20,
      }),
    ]);

    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const tonePhrase =
      tone === 'formal'
        ? 'Usá un tono formal y profesional.'
        : tone === 'directo'
        ? 'Usá un tono directo y conciso, sin rodeos.'
        : 'Usá un tono amigable y cercano, con algún emoji cuando sea natural.';

    const catalogLines = services.length
      ? services.map((s) => `- ${s.name}: ${s.price} ${s.currency} (${s.duration} min)`).join('\n')
      : '- (Todavía no hay servicios cargados)';

    const prompt = [
      `Sos el asistente virtual de "${business.name}".`,
      tonePhrase,
      '',
      'Tu trabajo es:',
      '1. Ayudar a agendar turnos (preguntá servicio, día y horario preferido).',
      '2. Informar sobre el catálogo de servicios y precios.',
      '3. Responder preguntas frecuentes sobre el negocio.',
      '4. Derivar a un humano si el cliente lo pide explícitamente.',
      '',
      'Catálogo actual:',
      catalogLines,
      '',
      'Reglas importantes:',
      '- No inventes precios, horarios ni disponibilidad que no te hayan sido provistos.',
      '- Respondé siempre en español, en mensajes breves (ideal para chat/WhatsApp).',
      '- Si no sabés algo, decilo con honestidad y ofrecé derivar a un humano.',
    ].join('\n');

    res.json({ prompt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    console.error('Generate prompt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/ai/providers
 * Lista los proveedores de IA soportados y si están configurados
 * (tienen API key seteada en el entorno) o no.
 */
router.get('/providers', requireAuth, async (_req, res) => {
  try {
    const providers = listAvailableProviders();
    let defaultProvider: string | null = null;
    try {
      defaultProvider = getDefaultAIProvider().name;
    } catch {
      // Ningún proveedor configurado todavía: se deja defaultProvider en null.
    }
    res.json({ providers, defaultProvider });
  } catch (error) {
    console.error('List providers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as aiRouter };
