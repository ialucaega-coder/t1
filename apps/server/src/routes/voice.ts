/**
 * Rutas del asistente de llamadas por voz (Twilio Voice).
 *
 * Flujo de una llamada:
 *   1. Entra la llamada  → Twilio hace POST a  /api/voice/incoming
 *      Respondemos TwiML: saludo + <Gather input="speech"> que apunta a /respond.
 *   2. El cliente habla  → Twilio transcribe y hace POST a /api/voice/respond
 *      con SpeechResult. Pasamos el texto al cerebro (processMessage, canal
 *      VOICE), respondemos con <Say> y otro <Gather> para seguir la charla.
 *   3. Se repite hasta que el cliente cuelga o pide un humano.
 *
 * Todos los textos, idioma y voz salen de la config por negocio
 * (services/voice/config.ts), por lo que cada negocio suena distinto.
 *
 * Los webhooks son externos (sin auth, sin CSRF: Twilio no envía la cookie de
 * sesión). Las rutas /config y /status sí requieren auth. Twilio postea en
 * application/x-www-form-urlencoded, así que el router monta su propio parser.
 */
import { Router, type Request, type Response } from 'express';
import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import {
  isVoiceConfigured,
  validateVoiceSignature,
  resolveBusinessByNumber,
  VoiceResponse,
} from '../services/voice/client';
import {
  loadVoiceSettings,
  saveVoiceSettings,
  interpolate,
  type VoiceSettings,
} from '../services/voice/config';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

// Twilio postea formularios url-encoded.
router.use(express.urlencoded({ extended: false }));

const RESPOND_PATH = '/api/voice/respond';

/** Construye la URL pública completa del webhook (para validar firma). */
function fullUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  return `${protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Firma segura por defecto: validamos siempre la firma de Twilio salvo opt-in
 * explícito para desarrollo local (SKIP_WEBHOOK_SIGNATURE_VALIDATION=true),
 * igual que los webhooks de WhatsApp y Meta. Antes fallaba-abierto salvo que
 * NODE_ENV fuera exactamente 'production', lo que dejaba staging/preview sin
 * firma.
 */
function verifiedTwilio(req: Request, res: Response): boolean {
  if (process.env.SKIP_WEBHOOK_SIGNATURE_VALIDATION === 'true') return true;
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature || !validateVoiceSignature(fullUrl(req), req.body, signature)) {
    res.status(403).send('Invalid signature');
    return false;
  }
  return true;
}

/** Envía un TwiML como respuesta XML. */
function sendTwiml(res: Response, twiml: InstanceType<typeof VoiceResponse>): void {
  res.type('text/xml').send(twiml.toString());
}

/**
 * Agrega al TwiML un <Gather> de voz que reenvía la transcripción a /respond,
 * usando la voz e idioma configurados por el negocio.
 */
function gatherSpeech(
  twiml: InstanceType<typeof VoiceResponse>,
  prompt: string,
  cfg: VoiceSettings
): void {
  const gather = twiml.gather({
    input: ['speech'],
    action: RESPOND_PATH,
    method: 'POST',
    language: cfg.language,
    speechTimeout: 'auto',
    actionOnEmptyResult: true,
  } as any);
  gather.say({ voice: cfg.voice, language: cfg.language } as any, prompt);
}

// ─── Rutas autenticadas del panel ──────────────────────────────────────────

/** GET /api/voice/status — diagnóstico de configuración de Twilio. */
router.get('/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const cfg = await loadVoiceSettings(req.auth!.businessId);
  res.json({
    configured: isVoiceConfigured(),
    language: cfg.language,
    voice: cfg.voice,
    enabled: cfg.enabled,
    hint: isVoiceConfigured()
      ? 'Configurá el webhook de voz de tu número Twilio a POST /api/voice/incoming'
      : 'Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en las variables de entorno',
  });
}));

/** GET /api/voice/config — config de voz del negocio. */
router.get('/config', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const cfg = await loadVoiceSettings(req.auth!.businessId);
  res.json(cfg);
}));

const configSchema = z.object({
  enabled: z.boolean().optional(),
  assistantName: z.string().trim().min(1).max(60).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  voice: z.string().trim().min(1).max(60).optional(),
  rate: z.number().min(0.5).max(1.5).optional(),
  greeting: z.string().trim().min(1).max(600).optional(),
  closing: z.string().trim().min(1).max(600).optional(),
  reprompt: z.string().trim().min(1).max(600).optional(),
  persona: z.string().trim().max(1500).optional(),
});

/** PUT /api/voice/config — actualiza la config de voz (solo ADMIN). */
router.put(
  '/config',
  requireAuth,
  requireRole('ADMIN'),
  validate(configSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const cfg = await saveVoiceSettings(req.auth!.businessId, req.body);
    res.json(cfg);
  })
);

// ─── Webhooks de Twilio (sin auth) ──────────────────────────────────────────

/**
 * POST /api/voice/incoming — Twilio invoca esto cuando entra una llamada.
 * Saluda con el saludo configurado y abre el primer <Gather>.
 */
router.post(
  '/incoming',
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifiedTwilio(req, res)) return;

    const to = req.body.To || '';
    const twiml = new VoiceResponse();

    const businessId = await resolveBusinessByNumber(to);
    if (!businessId) {
      twiml.say('Lo sentimos, este número no está disponible en este momento. Adiós.');
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    const cfg = await loadVoiceSettings(businessId);
    if (!cfg.enabled) {
      twiml.say({ voice: cfg.voice, language: cfg.language } as any, cfg.closing);
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const greeting = interpolate(cfg.greeting, business?.name || 'nuestro negocio', cfg.assistantName);

    gatherSpeech(twiml, greeting, cfg);
    // Si no dice nada, reintenta una vez y luego cierra.
    twiml.redirect({ method: 'POST' }, RESPOND_PATH);

    sendTwiml(res, twiml);
  })
);

/**
 * POST /api/voice/respond — recibe la transcripción de lo que dijo el cliente,
 * la procesa con la IA y responde por voz, manteniendo la conversación abierta.
 */
router.post(
  '/respond',
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifiedTwilio(req, res)) return;

    const to = req.body.To || '';
    const from = req.body.From || '';
    const speech: string = (req.body.SpeechResult || '').trim();
    const twiml = new VoiceResponse();

    const businessId = await resolveBusinessByNumber(to);
    if (!businessId) {
      twiml.say('Lo sentimos, ocurrió un problema. Adiós.');
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    const cfg = await loadVoiceSettings(businessId);

    // El cliente no dijo nada inteligible: repreguntamos.
    if (!speech) {
      gatherSpeech(twiml, cfg.reprompt, cfg);
      twiml.say({ voice: cfg.voice, language: cfg.language } as any, cfg.closing);
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    // Reutilizamos la conversación de voz abierta con este número (continuidad
    // entre turnos de la misma llamada / llamadas recientes).
    const existing = await prisma.conversation.findFirst({
      where: { businessId, contactPhone: from, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
    });

    let responseText = 'Disculpá, tuve un inconveniente. ¿Podés repetirlo?';
    let escalate = false;

    try {
      const result = await processMessage(businessId, speech, 'VOICE', {
        conversationId: existing?.id,
        contactPhone: from,
        systemPromptExtra: cfg.persona,
      });
      responseText = result.text;
      escalate = result.actions.some((a) => a.type === 'escalateToHuman');
    } catch (error) {
      console.error('Voice respond error:', error);
    }

    if (escalate) {
      twiml.say({ voice: cfg.voice, language: cfg.language } as any, responseText);
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    twiml.say({ voice: cfg.voice, language: cfg.language } as any, responseText);
    gatherSpeech(twiml, '¿Necesitás algo más?', cfg);
    twiml.say({ voice: cfg.voice, language: cfg.language } as any, cfg.closing);
    twiml.hangup();

    sendTwiml(res, twiml);
  })
);

export { router as voiceRouter };
