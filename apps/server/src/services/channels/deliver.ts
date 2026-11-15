/**
 * Entrega de la respuesta de un humano al canal REAL de la conversación.
 *
 * Hasta ahora `POST /conversations/:id/reply` solo guardaba el mensaje en la base:
 * el cliente nunca recibía nada por WhatsApp/Instagram/Messenger/Telegram. Este
 * módulo despacha el texto por la primitiva que ya usa cada canal para contestar
 * (no inventa clientes nuevos ni toca credenciales):
 *
 *  - WHATSAPP   → `whatsapp.sendMessage(to, body, fromNumber)` (Twilio). Destino:
 *                 `contactPhone`. Remitente: el número dedicado del negocio.
 *  - INSTAGRAM  → Send API de Meta con el Page Access Token de la `Connection`
 *                 INSTAGRAM. Destino: `contactPhone` (acá se guarda el IGSID).
 *  - MESSENGER  → persiste como WEBCHAT + `metadata.realChannel='MESSENGER'`:
 *                 · con `metadata.subscriberId` es ManyChat → `sendText(apiKey, subscriberId, text)`;
 *                 · si no, es Messenger directo (Meta) → Send API con el token de la
 *                   `Connection` MESSENGER. Destino: `contactPhone` (PSID).
 *  - TELEGRAM   → bot del negocio (token de la `Connection` TELEGRAM). Destino:
 *                 `metadata.telegramChatId`. OJO: hoy el flujo de Telegram NO crea
 *                 `Conversation`, así que nada escribe ese campo todavía (ver abajo).
 *  - WEBCHAT (widget web) → `not_applicable`: el widget solo hace POST /public/chat
 *                 (pide-respuesta) y no lee mensajes de la base ni por socket, o sea
 *                 que el texto queda guardado pero el visitante no lo ve en vivo.
 *  - VOICE      → `not_applicable`: es una llamada, no hay canal de texto.
 *
 * Contrato: NUNCA lanza. Siempre devuelve `{ status, error?, providerMessageId? }`.
 * `sent` significa "el proveedor aceptó el mensaje" (Twilio lo encola; el estado
 * final de entrega llega por callbacks que hoy no consumimos).
 *
 * Ventana de 24 h: WhatsApp (Twilio 63016) e Instagram/Messenger (Meta code 10 /
 * subcode 2018278) rechazan los mensajes libres fuera de la ventana. Lo traducimos
 * a un mensaje legible; NO mandamos plantillas por nuestra cuenta.
 */
import { Api } from 'grammy';
import { prisma } from '../../lib/prisma';
import { safeDecrypt } from '../../lib/crypto';
import { sendMessage as sendWhatsApp } from '../whatsapp/client';
import { sendMessage as sendMeta } from '../meta/client';
import { loadMcConfig } from '../manychat/config';
import { sendText as sendManychat } from '../manychat/client';

export type DeliveryStatus = 'sent' | 'failed' | 'not_applicable';

export interface DeliveryResult {
  status: DeliveryStatus;
  /** Motivo legible (en español) cuando status = 'failed'. */
  error?: string;
  /** Id del mensaje en el proveedor (ej. SID de Twilio), si lo devolvió. */
  providerMessageId?: string;
}

/** Subconjunto de `Conversation` que necesitamos para despachar. */
export interface DeliverableConversation {
  id: string;
  channel: string;
  contactPhone: string | null;
  metadata: unknown;
}

/** Tope duro de la entrega: el handler HTTP no puede colgarse esperando al proveedor. */
const DELIVERY_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_DETAIL = 200;

class DeliveryError extends Error {}

function fail(error: string): DeliveryResult {
  return { status: 'failed', error };
}

function readMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_PROVIDER_DETAIL ? `${clean.slice(0, MAX_PROVIDER_DETAIL - 1)}…` : clean;
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DeliveryError('El proveedor tardó demasiado en responder. Puede que el mensaje igual haya salido: revisá antes de reintentar.')),
      DELIVERY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Traducción de errores de cada proveedor ────────────────────────────────

const WINDOW_MSG_WA =
  'WhatsApp no permite escribir mensajes libres pasadas 24 h desde el último mensaje del cliente. Esperá a que te escriba de nuevo o usá una plantilla aprobada.';
const WINDOW_MSG_META =
  'Pasaron más de 24 h desde el último mensaje del cliente: Instagram/Messenger no permite responder fuera de esa ventana.';

/** Errores de Twilio (RestException trae `code` numérico y `message`). */
function describeTwilioError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'number' ? e.code : undefined;
  const message = typeof e?.message === 'string' ? e.message : '';

  if (code === 63016) return WINDOW_MSG_WA;
  if (code === 63007) return 'El número de WhatsApp del negocio no está habilitado como remitente en Twilio.';
  if (code === 21211 || code === 21614) return 'El número del cliente no es válido para WhatsApp.';
  if (err instanceof Error && /Faltan TWILIO_|Falta TWILIO_/.test(message)) {
    return 'WhatsApp no está configurado en el servidor (faltan credenciales de Twilio).';
  }
  return `Twilio rechazó el envío${code ? ` (código ${code})` : ''}${message ? `: ${clip(message)}` : '.'}`;
}

/** Errores de la Send API de Meta: `sendMessage` lanza "Meta Send API respondió N: {json}". */
function describeMetaError(err: unknown, label: string): string {
  const raw = err instanceof Error ? err.message : '';
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { code?: number; error_subcode?: number; message?: string } };
      const code = parsed.error?.code;
      const sub = parsed.error?.error_subcode;
      if (code === 10 || sub === 2018278 || sub === 2534022) return WINDOW_MSG_META;
      if (code === 190) return `El token de ${label} venció o fue revocado: reconectá ${label} desde Integraciones.`;
      if (code === 551) return 'El cliente no está disponible para recibir mensajes en este momento.';
      if (parsed.error?.message) return `${label} rechazó el envío: ${clip(parsed.error.message)}`;
    } catch {
      /* JSON ilegible: cae al mensaje genérico */
    }
  }
  return `${label} rechazó el envío${raw ? `: ${clip(raw)}` : '.'}`;
}

/** Errores de grammy (`GrammyError` trae error_code + description). */
function describeTelegramError(err: unknown): string {
  const e = err as { error_code?: unknown; description?: unknown; message?: unknown } | null;
  const code = typeof e?.error_code === 'number' ? e.error_code : undefined;
  const description = typeof e?.description === 'string' ? e.description : typeof e?.message === 'string' ? e.message : '';
  if (code === 403) return 'El cliente bloqueó al bot de Telegram o nunca lo inició.';
  if (code === 400 && /chat not found/i.test(description)) return 'Telegram no encontró ese chat: el cliente tiene que escribirle primero al bot.';
  if (code === 401) return 'El token del bot de Telegram es inválido: reconectá Telegram desde Integraciones.';
  return `Telegram rechazó el envío${code ? ` (${code})` : ''}${description ? `: ${clip(description)}` : '.'}`;
}

// ─── Credenciales ya guardadas por el negocio (Connection / Business) ────────

async function loadMetaToken(businessId: string, type: 'INSTAGRAM' | 'MESSENGER'): Promise<string | null> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type, isActive: true },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  const cfg = readMetadata(conn?.config);
  if (typeof cfg.pageAccessToken !== 'string' || !cfg.pageAccessToken) return null;
  try {
    return safeDecrypt(cfg.pageAccessToken) || null;
  } catch {
    return null; // clave ilegible (p. ej. ENCRYPTION_KEY rotada): se trata como "sin token"
  }
}

async function loadTelegramToken(businessId: string): Promise<string | null> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: 'TELEGRAM', isActive: true },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  const cfg = readMetadata(conn?.config);
  try {
    if (typeof cfg.botTokenEnc === 'string' && cfg.botTokenEnc) return safeDecrypt(cfg.botTokenEnc) || null;
    if (typeof cfg.botToken === 'string' && cfg.botToken) return cfg.botToken; // legado en claro
  } catch {
    /* ilegible */
  }
  return null;
}

// ─── Despachadores por canal ────────────────────────────────────────────────

async function deliverWhatsApp(conv: DeliverableConversation, text: string, businessId: string): Promise<DeliveryResult> {
  const to = (conv.contactPhone ?? '').trim();
  if (!to) return fail('La conversación no tiene un teléfono de WhatsApp asociado.');

  // El mismo número por el que el cliente nos escribió: el dedicado del negocio o,
  // si el webhook lo resolvió por `business.phone`, ese. Sin ninguno cae al global
  // de la plataforma (igual que POST /whatsapp/send).
  const business = await prisma.business.findFirst({
    where: { id: businessId },
    select: { whatsappNumber: true, phone: true },
  });
  const from = business?.whatsappNumber || business?.phone || undefined;
  // DECISIÓN DE PRODUCTO PENDIENTE: sin número propio el mensaje sale desde el
  // número GLOBAL de la plataforma (TWILIO_PHONE_NUMBER), que el cliente puede no
  // reconocer como el del negocio y que mezcla remitentes entre tenants. Hoy se
  // mantiene igual que POST /whatsapp/send; definir si conviene bloquear el envío
  // (failed) cuando el negocio no tiene número dedicado.
  if (!from) {
    console.warn('[deliver] WhatsApp: el negocio no tiene número propio; se envía desde el número global', { businessId });
  }

  try {
    const sid = await sendWhatsApp(to, text, from);
    return { status: 'sent', providerMessageId: sid };
  } catch (err) {
    return fail(describeTwilioError(err));
  }
}

async function deliverMeta(
  conv: DeliverableConversation,
  text: string,
  businessId: string,
  platform: 'instagram' | 'messenger',
): Promise<DeliveryResult> {
  const label = platform === 'instagram' ? 'Instagram' : 'Messenger';
  const recipientId = (conv.contactPhone ?? '').trim();
  if (!recipientId) return fail(`La conversación no tiene el id del usuario de ${label}.`);

  const token = await loadMetaToken(businessId, platform === 'instagram' ? 'INSTAGRAM' : 'MESSENGER');
  if (!token) return fail(`${label} no está conectado (o su token no se pudo leer). Reconectalo desde Integraciones.`);

  try {
    await sendMeta(token, recipientId, text);
    return { status: 'sent' };
  } catch (err) {
    return fail(describeMetaError(err, label));
  }
}

async function deliverManychat(subscriberId: string, text: string, businessId: string): Promise<DeliveryResult> {
  const cfg = await loadMcConfig(businessId);
  if (!cfg) return fail('ManyChat no está conectado (o su API key no se pudo leer). Reconectalo desde Integraciones.');
  if (!cfg.enabled) return fail('La integración con ManyChat está desactivada para este negocio.');
  try {
    await sendManychat(cfg.apiKey, subscriberId, text);
    return { status: 'sent' };
  } catch (err) {
    const raw = err instanceof Error ? err.message : '';
    return fail(`ManyChat no pudo enviar el mensaje${raw ? `: ${clip(raw)}` : '.'}`);
  }
}

async function deliverTelegram(conv: DeliverableConversation, text: string, businessId: string): Promise<DeliveryResult> {
  const meta = readMetadata(conv.metadata);
  const rawChat = meta.telegramChatId;
  const chatId =
    typeof rawChat === 'number' && Number.isFinite(rawChat)
      ? rawChat
      : typeof rawChat === 'string' && /^-?\d+$/.test(rawChat.trim())
      ? rawChat.trim()
      : null;
  if (chatId === null) {
    return fail('Esta conversación de Telegram no tiene un chat asociado, así que no hay a dónde enviar la respuesta.');
  }

  const token = await loadTelegramToken(businessId);
  if (!token) return fail('Telegram no está conectado (o el token del bot no se pudo leer). Reconectalo desde Integraciones.');

  try {
    const sent = await new Api(token).sendMessage(chatId, text);
    return { status: 'sent', providerMessageId: String(sent.message_id) };
  } catch (err) {
    return fail(describeTelegramError(err));
  }
}

/**
 * Envía `text` al cliente por el canal real de `conversation`. Nunca lanza.
 * `businessId` debe ser el del auth: las credenciales se buscan siempre con él.
 */
export async function deliverToChannel(
  conversation: DeliverableConversation,
  text: string,
  businessId: string,
): Promise<DeliveryResult> {
  try {
    const meta = readMetadata(conversation.metadata);
    const realChannel = typeof meta.realChannel === 'string' ? meta.realChannel : '';

    const run = async (): Promise<DeliveryResult> => {
      if (realChannel === 'VOICE') return { status: 'not_applicable' };

      switch (conversation.channel) {
        case 'WHATSAPP':
          return deliverWhatsApp(conversation, text, businessId);
        case 'INSTAGRAM':
          return deliverMeta(conversation, text, businessId, 'instagram');
        case 'TELEGRAM':
          return deliverTelegram(conversation, text, businessId);
        case 'WEBCHAT': {
          if (realChannel === 'MESSENGER') {
            const subscriberId = typeof meta.subscriberId === 'string' ? meta.subscriberId.trim() : '';
            return subscriberId
              ? deliverManychat(subscriberId, text, businessId)
              : deliverMeta(conversation, text, businessId, 'messenger');
          }
          // Widget web: el mensaje queda guardado, pero el widget no lo consulta.
          return { status: 'not_applicable' };
        }
        default:
          return { status: 'not_applicable' };
      }
    };

    return await withTimeout(run());
  } catch (err) {
    if (err instanceof DeliveryError) return fail(err.message);
    // Log acotado (sin el texto del cliente ni payloads del proveedor).
    console.error('Error entregando respuesta humana al canal:', { channel: conversation.channel, error: (err as Error)?.message });
    return fail('No se pudo enviar el mensaje al cliente por un error inesperado.');
  }
}
