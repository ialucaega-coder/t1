/**
 * Tracking de aperturas y clics de campañas por EMAIL (sin tocar el schema).
 *
 *  - Cada email lleva, por destinatario, un pixel de 1×1 (apertura) y los links del
 *    texto reescritos como redirecciones (clic). Ambos usan un token FIRMADO con HMAC:
 *    sin el secreto nadie puede fabricar eventos ni usar la redirección contra una URL
 *    ajena (no es un open redirect: solo se redirige a la URL que firmamos al enviar).
 *  - Se cuenta UNA vez por destinatario y tipo (dedupe en sharedState). Los contadores
 *    viven en sharedState (Redis o memoria) y el porcentaje sobre `sentCount` se copia a
 *    `Campaign.openRate` / `Campaign.clickRate` (con debounce: no una escritura por evento).
 *  - Las aperturas por pixel son APROXIMADAS: los clientes de correo que precargan imágenes
 *    (Apple Mail Privacy Protection) las inflan y los que las bloquean las subcuentan. Los
 *    clics son más confiables, pero un escáner de seguridad puede abrir links. El panel lo aclara.
 *  - Sin `API_PUBLIC_URL` no hay a dónde apuntar el pixel/links: se envía igual, sin tracking.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { sharedGet, sharedIncr, sharedTryLock } from '../../lib/sharedState';
import { getAuthSecret } from '../../lib/secrets';

export type TrackingKind = 'o' | 'c';

export interface TrackingPayload {
  k: TrackingKind;
  /** businessId */
  b: string;
  /** campaignId */
  c: string;
  /** recipient (userId) */
  r: string;
  /** URL destino (solo clics) */
  u?: string;
}

/** Cuánto se recuerda qué destinatario ya abrió/clickeó (y los contadores). */
const TRACK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Máx. de caracteres de una URL que se reescribe (más larga se deja tal cual). */
const MAX_TRACKED_URL = 1500;
const PERSIST_DEBOUNCE_MS = 5000;

// ── Tokens firmados ──────────────────────────────────────────────────────────

function secret(): string | null {
  try {
    return crypto.createHmac('sha256', getAuthSecret()).update('campaign-tracking').digest('hex');
  } catch {
    return null; // sin secreto válido: no se firma, no hay tracking
  }
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sign = (data: string, key: string) =>
  crypto.createHmac('sha256', key).update(data).digest().subarray(0, 16).toString('base64url');

export function signTrackingToken(payload: TrackingPayload): string | null {
  const key = secret();
  if (!key) return null;
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, key)}`;
}

export function verifyTrackingToken(token: string, expected?: TrackingKind): TrackingPayload | null {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 4000) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(body, key));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TrackingPayload;
    if (p.k !== 'o' && p.k !== 'c') return null;
    if (expected && p.k !== expected) return null;
    if (typeof p.b !== 'string' || typeof p.c !== 'string' || typeof p.r !== 'string') return null;
    if (p.k === 'c' && (typeof p.u !== 'string' || !isHttpUrl(p.u))) return null;
    return p;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Cuerpo del email ─────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function publicBase(): string | null {
  const base = (process.env.API_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return base && isHttpUrl(base) ? base : null;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/**
 * Convierte el texto de la campaña en el HTML del email, para UN destinatario:
 * escapa el texto (antes se insertaba crudo), respeta los saltos de línea, reescribe los
 * links como redirecciones medidas y agrega el pixel de apertura. Sin base pública o
 * secreto devuelve el mismo HTML pero con los links directos y sin pixel.
 */
export function renderCampaignEmailHtml(
  text: string,
  ctx: { businessId: string; campaignId: string; recipientId: string },
): string {
  const base = publicBase();
  const tracked = base !== null && secret() !== null;

  let withLinks = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];
    // La puntuación final suele pertenecer a la oración, no a la URL.
    const trailing = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    if (trailing) url = url.slice(0, -trailing.length);
    let href = url;
    if (tracked && url.length <= MAX_TRACKED_URL && isHttpUrl(url)) {
      const token = signTrackingToken({ k: 'c', b: ctx.businessId, c: ctx.campaignId, r: ctx.recipientId, u: url });
      if (token) href = `${base}/api/public/track/c/${token}`;
    }
    withLinks +=
      escapeHtml(text.slice(last, start)) + `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>` + escapeHtml(trailing);
    last = start + m[0].length;
  }
  withLinks += escapeHtml(text.slice(last));

  const html = withLinks.replace(/\r?\n/g, '<br>');
  if (!tracked) return html;

  const pixel = signTrackingToken({ k: 'o', b: ctx.businessId, c: ctx.campaignId, r: ctx.recipientId });
  return pixel
    ? `${html}<img src="${base}/api/public/track/o/${pixel}.gif" width="1" height="1" alt="" style="display:none" />`
    : html;
}

// ── Registro de eventos ──────────────────────────────────────────────────────

const counterKey = (campaignId: string, kind: TrackingKind) => `track:${campaignId}:${kind}`;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Cuenta el evento si es el primero de ese destinatario para ese tipo. Nunca lanza
 * (es una medición, no puede romper el pixel ni la redirección).
 */
export async function recordTrackingEvent(p: TrackingPayload): Promise<boolean> {
  try {
    if (!(await sharedTryLock(`track:${p.k}:${p.c}:${p.r}`, TRACK_TTL_MS))) return false;
    await sharedIncr(counterKey(p.c, p.k), TRACK_TTL_MS);
    schedulePersist(p.b, p.c);
    return true;
  } catch {
    return false;
  }
}

function schedulePersist(businessId: string, campaignId: string): void {
  if (timers.has(campaignId)) return;
  const t = setTimeout(() => {
    timers.delete(campaignId);
    persistRates(businessId, campaignId).catch(() => undefined);
  }, PERSIST_DEBOUNCE_MS);
  t.unref?.();
  timers.set(campaignId, t);
}

const pct = (n: number, total: number) => (total > 0 ? Math.min(100, Math.round((n / total) * 1000) / 10) : 0);

/** Copia el porcentaje de aperturas/clics (únicos / enviados) a las columnas de la campaña. */
export async function persistRates(businessId: string, campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, businessId },
    select: { sentCount: true },
  });
  if (!campaign) return;
  const opens = (await sharedGet<number>(counterKey(campaignId, 'o'))) ?? 0;
  const clicks = (await sharedGet<number>(counterKey(campaignId, 'c'))) ?? 0;
  await prisma.campaign.updateMany({
    where: { id: campaignId, businessId },
    data: { openRate: pct(opens, campaign.sentCount), clickRate: pct(clicks, campaign.sentCount) },
  });
}
