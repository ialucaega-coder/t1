/**
 * Cliente de voz (Twilio Voice).
 *
 * El asistente de llamadas usa el Speech-to-Text nativo de Twilio (verbo
 * <Gather input="speech">) para transcribir lo que dice el cliente, pasa
 * ese texto al cerebro de IA compartido (services/chatbot.ts) y responde
 * con Text-to-Speech (<Say>). Reutiliza toda la lógica de disponibilidad,
 * catálogo y reservas que ya usan los canales de WhatsApp/Telegram/Web.
 *
 * No requiere ninguna dependencia nueva: solo `twilio` (ya instalado).
 */
import twilio from 'twilio';
import { prisma } from '../../lib/prisma';

/** ¿Están configuradas las credenciales de Twilio para voz? */
export function isVoiceConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/**
 * Idioma y voz de TTS/STT. Configurables por env para adaptarse al país
 * del negocio. Por defecto español latinoamericano con una voz de Amazon
 * Polly (soportada de forma nativa por Twilio).
 */
export function getVoiceConfig() {
  return {
    language: process.env.VOICE_LANGUAGE || 'es-MX',
    voice: process.env.VOICE_TTS_VOICE || 'Polly.Mia',
  };
}

/**
 * Valida la firma de un webhook entrante de Twilio. En producción es
 * obligatorio; en desarrollo se permite para poder probar con herramientas
 * locales (ngrok, curl) sin firmar.
 */
export function validateVoiceSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

/**
 * Resuelve a qué negocio pertenece un número de teléfono entrante (el `To`
 * de la llamada, es decir el número Twilio del negocio).
 *
 * Estrategia, en orden:
 *  1. Coincidencia exacta con Business.phone o Business.whatsappNumber.
 *  2. Variable de entorno DEFAULT_VOICE_BUSINESS_ID (útil para un único
 *     negocio o para pruebas).
 *  3. En desarrollo, el primer negocio activo (para poder probar sin
 *     configurar números).
 *
 * Cuando se agregue un campo dedicado (p.ej. Business.voiceNumber) esta
 * función es el único lugar a actualizar.
 */
export async function resolveBusinessByNumber(toNumber: string): Promise<string | null> {
  const normalized = (toNumber || '').replace(/^tel:/, '').trim();

  if (normalized) {
    const byPhone = await prisma.business.findFirst({
      where: {
        isActive: true,
        OR: [{ phone: normalized }, { whatsappNumber: normalized }],
      },
      select: { id: true },
    });
    if (byPhone) return byPhone.id;
  }

  const envDefault = process.env.DEFAULT_VOICE_BUSINESS_ID;
  if (envDefault) {
    const exists = await prisma.business.findUnique({
      where: { id: envDefault },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  if (process.env.NODE_ENV !== 'production') {
    const first = await prisma.business.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (first) return first.id;
  }

  return null;
}

/** Type helper para construir TwiML de voz. */
export const VoiceResponse = twilio.twiml.VoiceResponse;
