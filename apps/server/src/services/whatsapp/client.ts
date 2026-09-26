import twilio from 'twilio';
import { prisma } from '../../lib/prisma';
import type { ImageInput } from '../ai';

let cachedClient: twilio.Twilio | null = null;

function getClient(): twilio.Twilio {
  if (cachedClient) return cachedClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en las variables de entorno');
  }

  cachedClient = twilio(accountSid, authToken);
  return cachedClient;
}

export function isConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

/**
 * Envía un WhatsApp. `fromNumber` permite usar el número dedicado del negocio
 * como remitente (multi-tenant); si se omite, cae al número global de la
 * plataforma (`TWILIO_PHONE_NUMBER`). El número que se pase debe estar
 * aprovisionado en la cuenta de Twilio (los números por-negocio lo están, ya
 * que son los mismos por los que Twilio enruta los mensajes entrantes).
 */
export async function sendMessage(to: string, body: string, fromNumber?: string): Promise<string> {
  const client = getClient();
  const from = fromNumber || process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('Falta TWILIO_PHONE_NUMBER');

  const msg = await client.messages.create({
    body,
    from: `whatsapp:${from}`,
    to: `whatsapp:${to}`,
  });

  return msg.sid;
}

export async function sendTemplate(to: string, contentSid: string, variables?: Record<string, string>): Promise<string> {
  const client = getClient();
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('Falta TWILIO_PHONE_NUMBER');

  const msg = await client.messages.create({
    from: `whatsapp:${from}`,
    to: `whatsapp:${to}`,
    contentSid,
    contentVariables: variables ? JSON.stringify(variables) : undefined,
  });

  return msg.sid;
}

export function validateWebhookSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

/** Bot de WhatsApp resuelto para un número de destino (negocio dueño + bot activo). */
export interface ResolvedWhatsappTarget {
  businessId: string;
  botId: string;
}

/**
 * Resolución multi-tenant: encuentra el bot de WhatsApp del negocio dueño del
 * número de DESTINO (`To`) que recibió el mensaje.
 *
 * Twilio manda el destino como `whatsapp:+549...`; le sacamos el prefijo y lo
 * comparamos contra el teléfono del negocio (`business.phone`) o su número de
 * WhatsApp dedicado (`business.whatsappNumber`), siguiendo el mismo patrón que
 * el canal de voz (`services/voice/client.ts` → `resolveBusinessByNumber`).
 *
 * Devuelve el negocio + bot activo, o `null` si ningún negocio activo posee ese
 * número (el webhook responde 200 OK sin procesar, igual que antes).
 */
export async function resolveBusinessByNumber(toNumber: string): Promise<ResolvedWhatsappTarget | null> {
  const normalized = (toNumber || '').replace(/^whatsapp:/, '').trim();
  if (!normalized) return null;

  const bot = await prisma.bot.findFirst({
    where: {
      channel: 'WHATSAPP',
      status: 'ACTIVE',
      business: {
        isActive: true,
        OR: [{ phone: normalized }, { whatsappNumber: normalized }],
      },
    },
    select: { id: true, businessId: true },
  });

  if (!bot) return null;
  return { businessId: bot.businessId, botId: bot.id };
}

/**
 * Parsea los medios adjuntos de un webhook de Twilio WhatsApp y devuelve solo
 * las imágenes (content-type que empiece con `image/`), hasta un máximo de 4.
 *
 * Twilio envía la cantidad en `NumMedia` y cada medio como `MediaUrl{i}` con su
 * `MediaContentType{i}` (ej. `image/jpeg`). Se devuelven en el formato que espera
 * `processMessage` (`ImageInput[]`). El gate por superpoder "Oído y vista" vive en
 * `processMessage`: si el negocio no lo tiene activo, las imágenes se ignoran allí.
 */
export function parseTwilioImages(body: Record<string, unknown>): ImageInput[] {
  const count = parseInt(String(body?.NumMedia ?? '0'), 10);
  if (!Number.isFinite(count) || count <= 0) return [];

  const images: ImageInput[] = [];
  const MAX_IMAGES = 4;

  for (let i = 0; i < count && images.length < MAX_IMAGES; i++) {
    const url = body[`MediaUrl${i}`];
    const contentType = body[`MediaContentType${i}`];
    if (
      typeof url === 'string' &&
      url &&
      typeof contentType === 'string' &&
      contentType.startsWith('image/')
    ) {
      images.push({ url, mediaType: contentType });
    }
  }

  return images;
}

/** Un medio de audio adjunto (nota de voz) parseado del webhook de Twilio. */
export interface AudioAttachment {
  url: string;
  mediaType: string;
}

/**
 * Parsea los adjuntos de audio (content-type `audio/*`) de un webhook de Twilio,
 * hasta un máximo de 2. Se usan para transcribir notas de voz de WhatsApp con
 * Whisper (superpoder "Oído y vista"). El gate por superpoder vive en el webhook.
 */
export function parseTwilioAudio(body: Record<string, unknown>): AudioAttachment[] {
  const count = parseInt(String(body?.NumMedia ?? '0'), 10);
  if (!Number.isFinite(count) || count <= 0) return [];

  const audios: AudioAttachment[] = [];
  const MAX_AUDIOS = 2;

  for (let i = 0; i < count && audios.length < MAX_AUDIOS; i++) {
    const url = body[`MediaUrl${i}`];
    const contentType = body[`MediaContentType${i}`];
    if (
      typeof url === 'string' &&
      url &&
      typeof contentType === 'string' &&
      contentType.startsWith('audio/')
    ) {
      audios.push({ url, mediaType: contentType });
    }
  }

  return audios;
}

/** Tope de bytes por imagen que descargamos de Twilio (5 MB, guarda de memoria/costo). */
const MAX_TWILIO_IMAGE_BYTES = 5 * 1024 * 1024;
/** Timeout de las descargas salientes a Twilio (evita handlers colgados). */
const TWILIO_FETCH_TIMEOUT_MS = 8000;

/**
 * Allow-list anti-SSRF: solo adjuntamos las credenciales Basic de Twilio si la
 * URL apunta efectivamente a un host de Twilio. Las `MediaUrl` vienen del body
 * del webhook (no confiable si la firma no se validó), así que sin esta guarda
 * un atacante podría hacernos mandar el `AccountSid:AuthToken` a su propio host.
 */
export function isTwilioMediaUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'api.twilio.com' || h.endsWith('.twilio.com');
  } catch {
    return false;
  }
}

/** Header Basic auth de Twilio (`AccountSid:AuthToken`), o null si faltan creds. */
export function getTwilioAuthHeader(): string | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

/**
 * Descarga las imágenes de Twilio (MediaUrl) usando Basic auth y las devuelve
 * como base64 embebido, listas para pasarle a Anthropic.
 *
 * ¿Por qué hace falta? Las `MediaUrl` de Twilio están protegidas con Basic auth
 * (`AccountSid:AuthToken`). Anthropic NO puede descargarlas por URL directa (le
 * daría 401), así que la visión por WhatsApp no funcionaba end-to-end. Acá las
 * bajamos nosotros con las credenciales y las mandamos como base64
 * (`ImageInput.base64`, que el proveedor ya soporta).
 *
 * Robustez: si falta configuración o una descarga falla / se pasa del tope de
 * tamaño, esa imagen se descarta en silencio (no rompe el webhook). Devuelve
 * solo las que se pudieron convertir.
 *
 * Seguridad: solo se adjunta la credencial a URLs de Twilio (`isTwilioMediaUrl`,
 * anti-SSRF), con timeout, y se corta por `Content-Length` antes de bufferizar.
 * El redirect de Twilio apunta a un enlace pre-firmado de S3, y `fetch` de Node
 * quita el header Authorization en redirecciones cross-origin.
 */
export async function downloadTwilioImagesAsBase64(images: ImageInput[]): Promise<ImageInput[]> {
  if (!images.length) return [];

  const authHeader = getTwilioAuthHeader();
  if (!authHeader) return [];

  const results = await Promise.all(
    images.map(async (img): Promise<ImageInput | null> => {
      // Si ya viene como base64 (otro canal), la dejamos pasar tal cual.
      if (img.base64) return img;
      if (!img.url || !isTwilioMediaUrl(img.url)) return null;

      try {
        const res = await fetch(img.url, {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(TWILIO_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;

        const contentType = res.headers.get('content-type') || img.mediaType || 'image/jpeg';
        if (!contentType.startsWith('image/')) return null;

        // Cortamos antes de bufferizar si el servidor declara un tamaño excesivo.
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_TWILIO_IMAGE_BYTES) return null;

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_TWILIO_IMAGE_BYTES) return null;

        return { base64: buf.toString('base64'), mediaType: contentType };
      } catch {
        return null;
      }
    })
  );

  return results.filter((img): img is ImageInput => img !== null);
}
