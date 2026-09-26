/**
 * Cliente de mensajería de Meta (Instagram Direct + Facebook Messenger).
 *
 * Instagram y Messenger comparten la MISMA Graph API: el webhook recibe eventos
 * con la misma forma (`entry[].messaging[]`) y las respuestas se mandan al mismo
 * endpoint (`/me/messages`) usando el Page Access Token del negocio. Lo único que
 * cambia es el campo `object` del payload ("instagram" vs "page") y la identidad
 * que resuelve el tenant (IG id vs Page id). Por eso un solo módulo cubre ambos.
 *
 * Persistencia sin tocar el schema: cada conexión se guarda como `Connection`
 * (type 'INSTAGRAM' | 'MESSENGER') con el token y los ids en `config`. El gate
 * por superpoder de visión ("Oído y vista") vive en `processMessage`.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import type { ImageInput } from '../ai';

/** Plataforma concreta dentro del ecosistema Meta. */
export type MetaPlatform = 'instagram' | 'messenger';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
/** Timeout de las llamadas salientes a Graph API (evita handlers colgados). */
const GRAPH_TIMEOUT_MS = 8000;

/** ¿Hay al menos las variables mínimas para operar el canal de Meta? */
export function isConfigured(): boolean {
  return Boolean(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN);
}

/** Mapea el `object` del webhook de Meta a nuestra plataforma interna. */
export function platformFromObject(object: unknown): MetaPlatform | null {
  if (object === 'instagram') return 'instagram';
  if (object === 'page') return 'messenger';
  return null;
}

/** El `type` de `Connection` que usamos para cada plataforma. */
export function connectionTypeFor(platform: MetaPlatform): 'INSTAGRAM' | 'MESSENGER' {
  return platform === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
}

/**
 * Valida la firma `X-Hub-Signature-256` que Meta adjunta a cada webhook.
 * Es un HMAC-SHA256 del cuerpo CRUDO (no el parseado) con el App Secret.
 * Devuelve false si falta config o la firma no coincide (comparación en
 * tiempo constante para no filtrar información por timing).
 */
export function validateSignature(rawBody: Buffer | string | undefined, signatureHeader: unknown): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return false;
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;
  if (rawBody === undefined) return false;

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
  const received = signatureHeader.slice('sha256='.length);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Un mensaje entrante ya normalizado desde el webhook de Meta. */
export interface MetaIncomingMessage {
  platform: MetaPlatform;
  /** Id de la página / cuenta de IG que RECIBIÓ el mensaje (para resolver el tenant). */
  recipientId: string;
  /** Id del usuario que ESCRIBIÓ (lo usamos como destino de la respuesta). */
  senderId: string;
  text: string;
  images: ImageInput[];
}

/**
 * Normaliza un payload de webhook de Meta a una lista de mensajes entrantes.
 *
 * Ignora de forma segura: echoes (mensajes que mandó el propio negocio),
 * recibos de lectura/entrega, reacciones y cualquier entry sin texto ni imagen.
 * Solo devuelve mensajes reales de clientes. Máx 4 imágenes por mensaje.
 */
export function parseMetaEvents(body: Record<string, unknown>): MetaIncomingMessage[] {
  const platform = platformFromObject(body?.object);
  if (!platform) return [];

  const entries = Array.isArray(body?.entry) ? (body.entry as Record<string, unknown>[]) : [];
  const out: MetaIncomingMessage[] = [];

  for (const entry of entries) {
    const messaging = Array.isArray(entry?.messaging) ? (entry.messaging as Record<string, unknown>[]) : [];
    for (const event of messaging) {
      const message = event?.message as Record<string, unknown> | undefined;
      if (!message || message.is_echo) continue; // echoes y no-mensajes fuera

      const sender = event?.sender as Record<string, unknown> | undefined;
      const recipient = event?.recipient as Record<string, unknown> | undefined;
      const senderId = typeof sender?.id === 'string' ? sender.id : '';
      const recipientId = typeof recipient?.id === 'string' ? recipient.id : '';
      if (!senderId || !recipientId) continue;

      const text = typeof message.text === 'string' ? message.text : '';

      const images: ImageInput[] = [];
      const attachments = Array.isArray(message.attachments) ? (message.attachments as Record<string, unknown>[]) : [];
      for (const att of attachments) {
        if (images.length >= 4) break;
        const payload = att?.payload as Record<string, unknown> | undefined;
        const url = payload?.url;
        if (att?.type === 'image' && typeof url === 'string' && url) {
          images.push({ url });
        }
      }

      if (!text && images.length === 0) continue; // stickers/otros sin contenido útil
      out.push({ platform, recipientId, senderId, text, images });
    }
  }

  return out;
}

/** Negocio + bot resueltos para una identidad de Meta (página o cuenta de IG). */
export interface ResolvedMetaTarget {
  businessId: string;
  botId: string;
  pageAccessToken: string;
}

/**
 * Resolución multi-tenant: encuentra el negocio dueño de la identidad de Meta
 * (`recipientId`) que recibió el mensaje, buscando una `Connection` activa del
 * tipo correcto cuyo `config.pageId` o `config.igId` coincida. Devuelve también
 * el Page Access Token para poder responder, y el `botId` guardado en la config.
 *
 * Si la conexión no guardó un `botId`, cae al bot activo del canal correspondiente
 * (INSTAGRAM para IG; para Messenger no hay valor de enum, así que toma el
 * primer bot del negocio como último recurso).
 */
export async function resolveBusinessByRecipient(
  platform: MetaPlatform,
  recipientId: string,
): Promise<ResolvedMetaTarget | null> {
  const id = (recipientId || '').trim();
  if (!id) return null;

  const type = connectionTypeFor(platform);
  const connections = await prisma.connection.findMany({
    where: { type, isActive: true, business: { isActive: true } },
    select: { businessId: true, config: true },
  });

  for (const conn of connections) {
    const cfg = (conn.config as Record<string, unknown> | null) || {};
    const matches = cfg.pageId === id || cfg.igId === id;
    if (!matches) continue;

    const pageAccessToken = typeof cfg.pageAccessToken === 'string' ? cfg.pageAccessToken : '';
    if (!pageAccessToken) return null;

    let botId = typeof cfg.botId === 'string' ? cfg.botId : '';
    if (!botId) {
      // El fallback filtra por el canal que usa /connect para cada plataforma
      // (INSTAGRAM para IG, WEBCHAT para Messenger — el enum no tiene MESSENGER),
      // para no agarrar por error un bot de WhatsApp/Telegram del mismo negocio.
      const bot = await prisma.bot.findFirst({
        where: {
          businessId: conn.businessId,
          status: 'ACTIVE',
          channel: platform === 'instagram' ? 'INSTAGRAM' : 'WEBCHAT',
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!bot) return null;
      botId = bot.id;
    }

    return { businessId: conn.businessId, botId, pageAccessToken };
  }

  return null;
}

/**
 * Envía un mensaje de texto por la Send API de Meta (sirve para IG y Messenger).
 * Usa el Page Access Token del negocio. Lanza si Meta responde con error para
 * que el caller lo loguee (el webhook igual responde 200 a Meta).
 */
export async function sendMessage(pageAccessToken: string, recipientId: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Meta Send API respondió ${res.status}: ${detail}`);
  }
}

/**
 * Verifica que un Page Access Token controle realmente la identidad declarada
 * (`expectedId` = pageId o igId). Sin esto, cualquier admin autenticado podría
 * reclamar el pageId/igId público de OTRO negocio con un token cualquiera y
 * secuestrar sus conversaciones (hijack cross-tenant).
 *
 * Consulta `GET /{expectedId}?fields=id` con el token: si el token tiene acceso
 * a ese nodo, Graph devuelve el mismo id; si no, devuelve error. Ante fallo de
 * red devuelve false (fail-closed). Se saltea solo si no hay App configurada
 * (META_APP_SECRET), para no bloquear entornos de desarrollo sin credenciales.
 */
export async function verifyTokenOwnership(pageAccessToken: string, expectedId: string): Promise<boolean> {
  if (!process.env.META_APP_SECRET) return true; // dev sin App configurada
  if (!pageAccessToken || !expectedId) return false;

  try {
    const url = `${GRAPH_BASE}/${encodeURIComponent(expectedId)}?fields=id&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return data?.id === expectedId;
  } catch {
    return false;
  }
}

/**
 * ¿Hay OTRO negocio (distinto de `businessId`) con una conexión activa que ya
 * reclamó esta identidad de Meta? Evita que dos tenants compartan el mismo
 * pageId/igId (la unicidad no se puede imponer a nivel de DB por ser JSON).
 */
export async function isRecipientClaimedByAnother(
  platform: MetaPlatform,
  identityId: string,
  businessId: string,
): Promise<boolean> {
  const type = connectionTypeFor(platform);
  const connections = await prisma.connection.findMany({
    where: { type, isActive: true, businessId: { not: businessId } },
    select: { config: true },
  });
  return connections.some((c) => {
    const cfg = (c.config as Record<string, unknown> | null) || {};
    return cfg.pageId === identityId || cfg.igId === identityId;
  });
}
