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
 * Estas rutas son webhooks externos (sin auth, sin CSRF: Twilio no envía la
 * cookie de sesión, por lo que csrfProtection las deja pasar). Twilio postea
 * en application/x-www-form-urlencoded, así que el router monta su propio
 * express.urlencoded.
 */
import { Router, type Request, type Response } from 'express';
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import {
  isVoiceConfigured,
  getVoiceConfig,
  validateVoiceSignature,
  resolveBusinessByNumber,
  VoiceResponse,
} from '../services/voice/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Twilio postea formularios url-encoded.
router.use(express.urlencoded({ extended: false }));

const RESPOND_PATH = '/api/voice/respond';

/** Construye la URL pública completa del webhook (para validar firma). */
function fullUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  return `${protocol}://${req.get('host')}${req.originalUrl}`;
}

/** En producción exige firma válida de Twilio; en dev la omite. */
function verifiedTwilio(req: Request, res: Response): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
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
 * Agrega al TwiML un <Gather> de voz que reenvía la transcripción a /respond.
 * `prompt` es lo que dice el asistente antes de escuchar.
 */
function gatherSpeech(twiml: InstanceType<typeof VoiceResponse>, prompt: string): void {
  const { language, voice } = getVoiceConfig();
  const gather = twiml.gather({
    input: ['speech'],
    action: RESPOND_PATH,
    method: 'POST',
    language,
    speechTimeout: 'auto',
    actionOnEmptyResult: true,
  } as any);
  gather.say({ voice, language } as any, prompt);
}

/** GET /api/voice/status — diagnóstico de configuración (requiere auth). */
router.get('/status', requireAuth, (_req: Request, res: Response) => {
  const { language, voice } = getVoiceConfig();
  res.json({
    configured: isVoiceConfigured(),
    language,
    voice,
    hint: isVoiceConfigured()
      ? 'Configurá el webhook de voz de tu número Twilio a POST /api/voice/incoming'
      : 'Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en las variables de entorno',
  });
});

/**
 * POST /api/voice/incoming — Twilio invoca esto cuando entra una llamada.
 * Saluda con el nombre del negocio y abre el primer <Gather>.
 */
router.post(
  '/incoming',
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifiedTwilio(req, res)) return;

    const { language, voice } = getVoiceConfig();
    const to = req.body.To || '';
    const twiml = new VoiceResponse();

    const businessId = await resolveBusinessByNumber(to);
    if (!businessId) {
      twiml.say({ voice, language } as any, 'Lo sentimos, este número no está disponible en este momento. Adiós.');
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const name = business?.name || 'nuestro negocio';

    gatherSpeech(
      twiml,
      `Hola, gracias por comunicarte con ${name}. Soy el asistente virtual. ¿En qué puedo ayudarte?`
    );
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

    const { language, voice } = getVoiceConfig();
    const to = req.body.To || '';
    const from = req.body.From || '';
    const speech: string = (req.body.SpeechResult || '').trim();
    const twiml = new VoiceResponse();

    const businessId = await resolveBusinessByNumber(to);
    if (!businessId) {
      twiml.say({ voice, language } as any, 'Lo sentimos, ocurrió un problema. Adiós.');
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    // El cliente no dijo nada inteligible: repreguntamos.
    if (!speech) {
      gatherSpeech(twiml, 'Perdón, no te escuché bien. ¿Me repetís, por favor?');
      twiml.say({ voice, language } as any, 'No recibí respuesta. Podés volver a llamar cuando quieras. ¡Hasta luego!');
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
      });
      responseText = result.text;
      escalate = result.actions.some((a) => a.type === 'escalateToHuman');
    } catch (error) {
      console.error('Voice respond error:', error);
    }

    if (escalate) {
      // Pedido de humano: avisamos y cerramos (el equipo recibe la notificación
      // que genera processMessage al detectar la intención HUMAN).
      twiml.say({ voice, language } as any, responseText);
      twiml.hangup();
      sendTwiml(res, twiml);
      return;
    }

    // Respondemos y seguimos escuchando.
    const { voice: v, language: l } = getVoiceConfig();
    twiml.say({ voice: v, language: l } as any, responseText);
    gatherSpeech(twiml, '¿Necesitás algo más?');
    twiml.say({ voice: v, language: l } as any, 'Gracias por llamar. ¡Que tengas un buen día!');
    twiml.hangup();

    sendTwiml(res, twiml);
  })
);

export { router as voiceRouter };
