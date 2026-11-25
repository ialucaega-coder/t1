/**
 * Atribución Click-to-WhatsApp (CTWA).
 *
 * Cuando un cliente llega a WhatsApp desde un anuncio (Click-to-WhatsApp Ad),
 * Twilio agrega al body del webhook inbound (`routes/whatsapp.ts`) una serie de
 * campos `Referral*` (strings). Acá los parseamos a un objeto normalizado que
 * se persiste en `Conversation.metadata.attribution` al crear la conversación.
 *
 * Es lógica pura y testeable: no toca DB ni dependencias externas.
 */

/** Origen de la conversación capturado del anuncio que la originó. */
export interface ConversationAttribution {
  /** Origen. 'ctwa' = vino de un Click-to-WhatsApp Ad. */
  source: 'ctwa';
  sourceType?: string; // 'ad' | 'post' (ReferralSourceType)
  sourceId?: string; // id del anuncio/post (ReferralSourceId)
  sourceUrl?: string; // ReferralSourceUrl
  headline?: string; // ReferralHeadline
  body?: string; // ReferralBody
  ctwaClid?: string; // ReferralCtwaClid (click id)
  mediaType?: string; // ReferralMediaType
  at: string; // ISO de cuándo se capturó (creación de la conversación)
}

/**
 * Toma un campo del body (posiblemente ausente o no-string), lo recorta y
 * devuelve el string resultante, o `undefined` si está ausente, no es string
 * o quedó vacío. Tolerante: nunca tira.
 */
function cleanField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * Parsea los campos `Referral*` del body del webhook de Twilio y arma la
 * atribución de la conversación.
 *
 * Devuelve `null` si no hay señal de ad: se considera señal la presencia (no
 * vacía) de al menos uno de `ReferralSourceId`, `ReferralCtwaClid` o
 * `ReferralHeadline`. Si hay señal, arma el objeto `source:'ctwa'` mapeando
 * cada `Referral*` a su campo (recortando strings y omitiendo vacíos/ausentes),
 * y setea `at` con `new Date().toISOString()` en el momento del parseo.
 *
 * Tolera campos ausentes o no-string sin romper.
 */
export function parseWhatsAppReferral(
  body: Record<string, unknown>,
): ConversationAttribution | null {
  const sourceType = cleanField(body.ReferralSourceType);
  const sourceId = cleanField(body.ReferralSourceId);
  const sourceUrl = cleanField(body.ReferralSourceUrl);
  const headline = cleanField(body.ReferralHeadline);
  const adBody = cleanField(body.ReferralBody);
  const ctwaClid = cleanField(body.ReferralCtwaClid);
  const mediaType = cleanField(body.ReferralMediaType);

  // Señal de ad: sin al menos uno de estos, no hubo click-to-WhatsApp.
  if (!sourceId && !ctwaClid && !headline) return null;

  const attribution: ConversationAttribution = {
    source: 'ctwa',
    at: new Date().toISOString(),
  };

  if (sourceType) attribution.sourceType = sourceType;
  if (sourceId) attribution.sourceId = sourceId;
  if (sourceUrl) attribution.sourceUrl = sourceUrl;
  if (headline) attribution.headline = headline;
  if (adBody) attribution.body = adBody;
  if (ctwaClid) attribution.ctwaClid = ctwaClid;
  if (mediaType) attribution.mediaType = mediaType;

  return attribution;
}
