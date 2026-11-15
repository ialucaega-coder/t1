import { httpClient } from './http-client';

export interface ConversationNote {
  text: string;
  at: string;
  by: string;
  byName?: string;
}

/**
 * Atribución Click-to-WhatsApp (CTWA): de qué anuncio/campaña vino la
 * conversación. Se captura al crear la charla y se guarda en
 * `Conversation.metadata.attribution`. Espejo del contrato de la feature.
 */
export interface ConversationAttribution {
  /** Origen. 'ctwa' = vino de un Click-to-WhatsApp Ad. */
  source: 'ctwa';
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  ctwaClid?: string;
  mediaType?: string;
  /** ISO de cuándo se capturó (creación de la conversación). */
  at: string;
}

// Datos extra guardados dentro de Conversation.metadata (campo Json del schema).
export interface ConversationMeta {
  assignedTo?: string | null;
  assignedToName?: string | null;
  tags?: string[];
  notes?: ConversationNote[];
  /** Lectura por usuario: userId -> ISO timestamp. */
  readBy?: Record<string, string>;
  lastReadAt?: string | null;
  /** Canal real cuando no tiene enum propio (ej: 'MESSENGER'/'VOICE' sobre WEBCHAT). */
  realChannel?: string;
  /** Bot pausado en esta conversación (un agente la tomó). */
  botPaused?: boolean;
  pausedBy?: string | null;
  pausedByName?: string | null;
  pausedAt?: string | null;
  /** Último lead score calculado (intención de compra). */
  leadScore?: LeadScore;
  /** Atribución CTWA: de qué anuncio vino la conversación (si vino de uno). */
  attribution?: ConversationAttribution;
}

/** Lead scoring de intención de compra (temperatura + puntaje 0-100). */
export type LeadTemperature = 'CALIENTE' | 'TIBIO' | 'FRIO';
export interface LeadScore {
  temperature: LeadTemperature;
  score: number;
  reason: string;
  at: string;
}

/** Vistas del Inbox estilo respond.io. */
export type InboxView = 'all' | 'attention' | 'unread' | 'leads';

export interface Conversation {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'HANDOFF';
  channel: string;
  /**
   * Canal efectivo a mostrar/filtrar. Puede diferir de `channel` cuando el canal
   * real no tiene enum propio (ej: Messenger/Voz se persisten como WEBCHAT). Si
   * no viene, usar `channel`.
   */
  displayChannel?: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  metadata?: ConversationMeta | null;
  createdAt: string;
  updatedAt: string;
  bot?: { name: string; channel: string };
  _count?: { messages: number };
  messages?: { text: string; role: string; createdAt: string }[];
}

/** Metadata de un mensaje. Las respuestas humanas traen sender='human' + estado de entrega. */
export interface MessageMeta {
  sender?: 'human';
  userId?: string;
  userName?: string;
  deliveryStatus?: DeliveryStatus;
  deliveryError?: string;
  deliveryAttempts?: number;
}

export interface ConversationDetail extends Conversation {
  messages: { id: string; role: string; text: string; responseTime: number | null; createdAt: string; metadata?: MessageMeta | null }[];
  /** Solo con paginación de mensajes (`limit`): hay mensajes anteriores sin cargar. */
  hasMoreMessages?: boolean;
}

export function list(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  channel?: string;
  view?: InboxView;
  /** Búsqueda en servidor por nombre / teléfono / email del contacto. */
  search?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params?.status) qs.set('status', params.status);
  if (params?.channel) qs.set('channel', params.channel);
  if (params?.view && params.view !== 'all') qs.set('view', params.view);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString();
  return httpClient.get<{ data: Conversation[]; total: number; page: number; pageSize: number }>(
    `/conversations${query ? `?${query}` : ''}`
  );
}

/**
 * Detalle de la conversación. Sin `opts` trae el hilo completo; con `limit` trae
 * los N mensajes más recientes y `before` (id de mensaje) los N anteriores a ese.
 */
export function getById(id: string, opts?: { limit?: number; before?: string }) {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set('limit', String(opts.limit));
  if (opts?.before) qs.set('before', opts.before);
  const query = qs.toString();
  return httpClient.get<ConversationDetail>(`/conversations/${id}${query ? `?${query}` : ''}`);
}

export function close(id: string) {
  return httpClient.patch<{ success: boolean }>(`/conversations/${id}/close`, {});
}

/** Estado de entrega de una respuesta humana al canal real del cliente. */
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'not_applicable';

/** Respuesta de POST /reply (y /retry): el mensaje guardado + cómo salió el envío. */
export interface ReplyResult {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  metadata?: MessageMeta | null;
  deliveryStatus: DeliveryStatus;
  /** Motivo legible del fallo cuando deliveryStatus = 'failed'. */
  deliveryError?: string;
}

/** Duplicado detectado por Idempotency-Key: el primer request ya se encargó. */
export interface ReplyDuplicate {
  duplicate: true;
}

/**
 * Responde como humano: guarda el mensaje y lo envía al canal real. Si se pasa
 * `idempotencyKey`, un doble click o reintento de red no manda el texto dos veces.
 */
export function reply(id: string, text: string, idempotencyKey?: string) {
  return httpClient.post<ReplyResult | ReplyDuplicate>(
    `/conversations/${id}/reply`,
    { text },
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
}

/** Reintenta el envío de una respuesta cuya entrega falló (no crea otro mensaje). */
export function retryReply(id: string, messageId: string) {
  return httpClient.post<ReplyResult>(`/conversations/${id}/reply/${messageId}/retry`, {});
}

// Asigna la conversación a un miembro del equipo (o desasigna con null).
export function assign(id: string, assignedTo: string | null) {
  return httpClient.patch<{ metadata: ConversationMeta }>(`/conversations/${id}/assign`, { assignedTo });
}

// Reemplaza el conjunto de etiquetas de la conversación.
export function setTags(id: string, tags: string[]) {
  return httpClient.patch<{ metadata: ConversationMeta }>(`/conversations/${id}/tags`, { tags });
}

// Agrega una nota interna a la conversación.
export function addNote(id: string, text: string) {
  return httpClient.post<{ note: ConversationNote; metadata: ConversationMeta }>(`/conversations/${id}/notes`, { text });
}

// Marca la conversación como leída.
export function markRead(id: string) {
  return httpClient.patch<{ metadata: ConversationMeta }>(`/conversations/${id}/read`, {});
}

// Copiloto del inbox: pide a la IA del negocio un resumen de la conversación y
// una respuesta sugerida para el agente. Solo lectura: no envía nada al cliente.
export interface CopilotResult {
  summary: string;
  suggestedReply: string;
}
export function copilot(id: string) {
  return httpClient.post<CopilotResult>(`/conversations/${id}/copilot`, {});
}

// Lead scoring: pide a la IA del negocio estimar la intención de compra del
// cliente. Persiste el resultado en metadata y lo devuelve para mostrarlo.
export function leadScore(id: string) {
  return httpClient.post<LeadScore>(`/conversations/${id}/lead-score`, {});
}

// Toma la conversación: pausa el bot en esta conversación para responder como humano.
export function take(id: string) {
  return httpClient.post<{ metadata: ConversationMeta }>(`/conversations/${id}/take`, {});
}

// Reactiva el bot en la conversación (opuesto a take).
export function release(id: string) {
  return httpClient.post<{ metadata: ConversationMeta }>(`/conversations/${id}/release`, {});
}
