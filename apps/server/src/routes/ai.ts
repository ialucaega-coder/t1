/**
 * Rutas de IA: chat del bot, generación de prompts y listado de proveedores.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { listAvailableProviders, getDefaultAIProvider } from '../services/ai';
import { listEnginesForBusiness, setActiveEngine, setEngineKey } from '../services/ai/engine';
import type { ProviderFamily } from '../services/ai/catalog';

const router = Router();

const PROVIDER_FAMILIES: ProviderFamily[] = [
  'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'mistral',
  'together', 'perplexity', 'cohere', 'ollama', 'lmstudio',
];

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
router.post('/chat', requireAuth, asyncHandler(async (req, res) => {
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
}));

const generatePromptSchema = z.object({
  tone: z.enum(['formal', 'amigable', 'directo']).default('amigable'),
});

/**
 * POST /api/ai/generate-prompt
 * Genera (o regenera) un prompt de sistema a partir de los datos reales
 * del negocio (nombre, servicios, etc.), listo para copiar/pegar o guardar.
 */
router.post('/generate-prompt', requireAuth, asyncHandler(async (req, res) => {
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
}));

/**
 * GET /api/ai/providers
 * Lista los proveedores de IA soportados y si están configurados
 * (tienen API key seteada en el entorno) o no.
 */
router.get('/providers', requireAuth, asyncHandler(async (_req, res) => {
  const providers = listAvailableProviders();
  let defaultProvider: string | null = null;
  try {
    defaultProvider = getDefaultAIProvider().name;
  } catch {
    // Ningún proveedor configurado todavía
  }
  res.json({ providers, defaultProvider });
}));

// ────────────────────────────────────────────────────────────────
// Motor de IA: catálogo de modelos, selección del activo y API keys
// ────────────────────────────────────────────────────────────────

/**
 * GET /api/ai/engines
 * Devuelve el catálogo de motores con su estado para el negocio: cuál está
 * activo, cuáles tienen key propia, cuáles pueden ir por relay y cuáles están
 * listos. Nunca expone el valor de las keys.
 */
router.get('/engines', requireAuth, asyncHandler(async (req, res) => {
  const data = await listEnginesForBusiness(req.auth!.businessId);
  res.json(data);
}));

const setEngineSchema = z.object({ engineId: z.string().min(1) });

/**
 * PUT /api/ai/engine
 * Cambia el motor de IA activo del negocio.
 */
router.put('/engine', requireAuth, asyncHandler(async (req, res) => {
  const { engineId } = setEngineSchema.parse(req.body);
  try {
    const cfg = await setActiveEngine(req.auth!.businessId, engineId);
    res.json({ success: true, activeEngineId: cfg.activeEngineId });
  } catch {
    res.status(400).json({ error: 'Motor de IA desconocido' });
  }
}));

const setKeySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().max(400).default(''),
});

/**
 * PUT /api/ai/keys
 * Guarda (o borra, con apiKey vacía) la API key propia del negocio para una
 * familia de proveedor. La key se guarda cifrada-en-reposo por la DB; nunca se
 * devuelve al cliente.
 */
router.put('/keys', requireAuth, asyncHandler(async (req, res) => {
  const { provider, apiKey } = setKeySchema.parse(req.body);
  if (!PROVIDER_FAMILIES.includes(provider as ProviderFamily)) {
    res.status(400).json({ error: 'Proveedor desconocido' });
    return;
  }
  await setEngineKey(req.auth!.businessId, provider as ProviderFamily, apiKey);
  res.json({ success: true });
}));

export { router as aiRouter };
