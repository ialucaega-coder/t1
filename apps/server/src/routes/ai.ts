/**
 * Rutas de IA: chat del bot, generación de prompts y listado de proveedores.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { listAvailableProviders, getDefaultAIProvider } from '../services/ai';
import { listEnginesForBusiness, setActiveEngine, setEngineKey, UnknownEngineError } from '../services/ai/engine';
import { loadSystemPrompt, saveSystemPrompt, MAX_SYSTEM_PROMPT_LENGTH } from '../services/ai/system-prompt';
import { getUsageSummary, currentMonthWindow, getSpendByBusinessSince } from '../services/ai/usage';
import { getSpendStatus, setSpendCap, levelFor, MAX_CAP_USD } from '../services/ai/spendCap';
import { requirePlatformAdmin } from '../middleware/platformAdmin';
import { getMessageQuota } from '../services/billing/quota';
import type { ProviderFamily } from '../services/ai/catalog';
import { cache, cacheKey } from '../lib/cache';

const router = Router();

const PROVIDER_FAMILIES: ProviderFamily[] = [
  'openai', 'anthropic', 'gemini', 'groq', 'xai', 'deepseek', 'mistral',
  'together', 'perplexity', 'cohere', 'openrouter', 'ollama', 'lmstudio',
];

/** Topes del chat de prueba: cada mensaje del historial entra al prompt (costo de IA). */
const MAX_CHAT_TEXT = 4000;
const MAX_CHAT_HISTORY = 20;

const chatSchema = z.object({
  message: z.string().min(1).max(MAX_CHAT_TEXT),
  channel: z.enum(['WEB', 'TELEGRAM', 'WHATSAPP', 'VOICE']).default('WEB'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(MAX_CHAT_TEXT),
      })
    )
    .max(MAX_CHAT_HISTORY)
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
router.post('/chat', requireAuth, tenantRateLimit({ name: 'ai-chat', max: 60 }), asyncHandler(async (req, res) => {
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
router.post('/generate-prompt', requireAuth, tenantRateLimit({ name: 'ai-generate-prompt', max: 10 }), asyncHandler(async (req, res) => {
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
 * GET /api/ai/system-prompt
 * Devuelve el prompt de sistema personalizado guardado del negocio ('' si no hay).
 */
router.get('/system-prompt', requireAuth, asyncHandler(async (req, res) => {
  const prompt = await loadSystemPrompt(req.auth!.businessId);
  res.json({ prompt });
}));

const systemPromptSchema = z.object({
  prompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH),
});

/**
 * PUT /api/ai/system-prompt
 * Guarda el prompt de sistema personalizado (solo ADMIN). Se inyecta en el
 * prompt del chatbot en todos los canales.
 */
router.put('/system-prompt', requireAuth, requireRole('ADMIN'), validate(systemPromptSchema), asyncHandler(async (req, res) => {
  const prompt = await saveSystemPrompt(req.auth!.businessId, req.body.prompt);
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
 * Cambia el motor de IA activo del negocio. Solo ADMIN: define con qué modelo (y
 * con qué key) responde el bot, o sea el costo y el comportamiento del negocio.
 */
router.put('/engine', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { engineId } = setEngineSchema.parse(req.body);
  try {
    const cfg = await setActiveEngine(req.auth!.businessId, engineId);
    res.json({ success: true, activeEngineId: cfg.activeEngineId });
  } catch (err) {
    // Solo un motor inexistente es culpa del cliente (400). Un fallo real (la base,
    // etc.) sigue de largo al manejador de errores como 500, en vez de disfrazarse
    // de "motor desconocido".
    if (err instanceof UnknownEngineError) {
      res.status(400).json({ error: 'Motor de IA desconocido' });
      return;
    }
    throw err;
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
 * devuelve al cliente. Solo ADMIN (reemplazar o borrar la key deja al bot sin motor).
 */
router.put('/keys', requireAuth, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { provider, apiKey } = setKeySchema.parse(req.body);
  if (!PROVIDER_FAMILIES.includes(provider as ProviderFamily)) {
    res.status(400).json({ error: 'Proveedor desconocido' });
    return;
  }
  await setEngineKey(req.auth!.businessId, provider as ProviderFamily, apiKey);
  res.json({ success: true });
}));

const USAGE_TTL_MS = 60_000;

/**
 * GET /api/ai/usage?days=30
 * Resumen de consumo de IA (tokens + costo estimado) del negocio, agregado por
 * día y por modelo. Cacheado 60s (varias tarjetas del panel pueden pedirlo).
 */
router.get('/usage', requireAuth, asyncHandler(async (req, res) => {
  const businessId = req.auth!.businessId;
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);

  const key = cacheKey(businessId, 'ai-usage', String(days));
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  const summary = await getUsageSummary(businessId, days);
  cache.set(key, summary, USAGE_TTL_MS);
  res.json(summary);
}));

/**
 * GET /api/ai/quota
 * Cupo mensual de mensajes del bot del negocio (uso, límite del plan y restante).
 * Enforza el `maxMessages` del plan que antes solo se mostraba.
 */
router.get('/quota', requireAuth, asyncHandler(async (req, res) => {
  const quota = await getMessageQuota(req.auth!.businessId);
  res.json(quota);
}));

const spendCapSchema = z.object({
  // null quita el tope. USD por mes; máximo razonable para evitar typos.
  capUsd: z.number().positive().max(MAX_CAP_USD).nullable(),
});

/**
 * GET /api/ai/spend-cap
 * Tope mensual de gasto de IA del negocio y cuánto lleva gastado este mes.
 */
router.get('/spend-cap', requireAuth, asyncHandler(async (req, res) => {
  res.json(await getSpendStatus(req.auth!.businessId, true));
}));

/**
 * PUT /api/ai/spend-cap
 * Fija (o quita con `capUsd: null`) el tope mensual de gasto de IA. Solo ADMIN.
 */
router.put('/spend-cap', requireAuth, requireRole('ADMIN'), validate(spendCapSchema), asyncHandler(async (req, res) => {
  const { capUsd } = req.body as z.infer<typeof spendCapSchema>;
  await setSpendCap(req.auth!.businessId, capUsd);
  res.json(await getSpendStatus(req.auth!.businessId, true));
}));

/**
 * GET /api/ai/spend-overview
 * Super Admin: gasto de IA del mes por negocio (con tope y nivel). Cruza todos
 * los negocios, por eso va detrás de `requirePlatformAdmin`.
 */
router.get('/spend-overview', requireAuth, requirePlatformAdmin, asyncHandler(async (_req, res) => {
  const { month, since } = currentMonthWindow();
  const [spendMap, caps] = await Promise.all([
    getSpendByBusinessSince(since),
    prisma.connection.findMany({
      where: { type: 'AI_SPEND_CAP', isActive: true },
      select: { businessId: true, config: true },
    }),
  ]);
  const capMap = new Map<string, number>();
  for (const c of caps) {
    const v = (c.config as { capUsd?: unknown } | null)?.capUsd;
    if (typeof v === 'number' && v > 0) capMap.set(c.businessId, v);
  }
  const ids = [...new Set([...spendMap.keys(), ...capMap.keys()])];
  const businesses = ids.length
    ? await prisma.business.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, subscription: { select: { plan: { select: { name: true } } } } },
      })
    : [];
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const plans = new Map(businesses.map((b) => [b.id, b.subscription?.plan?.name ?? null]));
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const rows = ids
    .map((id) => {
      const spentUsd = round(spendMap.get(id) ?? 0);
      const capUsd = capMap.get(id) ?? null;
      return {
        businessId: id,
        name: names.get(id) ?? id,
        /** Plan contratado (null si no tiene suscripción). */
        planName: plans.get(id) ?? null,
        spentUsd,
        capUsd,
        ratio: capUsd ? spentUsd / capUsd : null,
        level: levelFor(spentUsd, capUsd),
      };
    })
    .sort((a, b) => b.spentUsd - a.spentUsd)
    .slice(0, 200);
  res.json({ month, totalUsd: round(rows.reduce((s, r) => s + r.spentUsd, 0)), businesses: rows });
}));

export { router as aiRouter };
