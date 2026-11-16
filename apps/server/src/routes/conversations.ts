import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { generateCopilot } from '../services/ai/copilot';
import { generateLeadScore, type LeadScore } from '../services/ai/lead-score';
import type { ConversationAttribution } from '../services/whatsapp/attribution';
import { deliverToChannel, type DeliveryStatus } from '../services/channels/deliver';
import { mutateConversation, transitionAttention } from '../services/conversationState';
import { IDEMP_TYPE_MRGO, readIdempotencyKey, claimIdempotentKey, releaseIdempotentKey } from '../lib/idempotency';

/** Respuesta para acciones que no aplican a una conversación cerrada. */
const CLOSED_CONVERSATION_ERROR = {
  error: 'La conversación está cerrada: no se puede responder ni tomar.',
  code: 'CONVERSATION_CLOSED',
} as const;

/** Tope de intentos de envío por mensaje (el primero + reintentos manuales). */
const MAX_DELIVERY_ATTEMPTS = 5;

const replySchema = z.object({
  text: z.string().min(1).max(5000).transform((v) => v.trim()),
});

const assignSchema = z.object({
  // null / '' => desasignar
  assignedTo: z.string().max(60).nullable().optional(),
});

const tagsSchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20),
});

const noteSchema = z.object({
  text: z.string().min(1).max(2000).transform((v) => v.trim()),
});

// Nota interna del equipo guardada dentro de Conversation.metadata
interface ConversationNote {
  text: string;
  at: string;
  by: string;
  byName?: string;
}

// Forma de los datos extra que guardamos en Conversation.metadata (campo Json).
// No tocamos el schema de Prisma: todo vive acá dentro.
interface ConversationMeta {
  assignedTo?: string | null;
  assignedToName?: string | null;
  tags?: string[];
  notes?: ConversationNote[];
  /** Lectura por usuario: userId -> ISO timestamp de la última vez que la abrió. */
  readBy?: Record<string, string>;
  /** Compat: lectura global previa (se mantiene como fallback). */
  lastReadAt?: string | null;
  /**
   * Bot pausado en ESTA conversación: cuando es true, un agente la "tomó" y el
   * bot no debe responder automáticamente (el motor de chatbot debe chequear
   * este flag antes de autorespoder). Se escribe vía /take (pausar) y /release
   * (reactivar). No existe columna para esto en el schema (congelado), así que
   * vive acá en metadata, igual que assignee/tags/notas.
   */
  botPaused?: boolean;
  /** Quién tomó la conversación (userId del agente) y su nombre/momento. */
  pausedBy?: string | null;
  pausedByName?: string | null;
  pausedAt?: string | null;
  /**
   * Canal real cuando no tiene enum propio en BotChannel (ej: 'MESSENGER' o
   * 'VOICE', que se persisten como WEBCHAT). Lo escribe el chatbot al crear la
   * conversación; el Inbox lo usa para mostrar/filtrar el canal correcto.
   */
  realChannel?: string;
  /**
   * Último lead score calculado para esta conversación (intención de compra).
   * Lo escribe POST /:id/lead-score; el Inbox lo muestra como badge de temperatura.
   */
  leadScore?: LeadScore;
  /**
   * Atribución Click-to-WhatsApp: de qué anuncio vino la conversación. La
   * escribe el chatbot al crear la conversación (sólo canal WhatsApp con ad);
   * el Inbox la usa para el badge "Anuncio".
   */
  attribution?: ConversationAttribution;
  [key: string]: unknown;
}

/** Máximo de notas internas que guardamos por conversación (evita JSON gigante). */
const MAX_NOTES = 200;

/**
 * Vistas del Inbox (estilo respond.io) que se piden con ?view=...:
 *  - 'all'       → Todas (sin filtro extra).
 *  - 'attention' → "Te necesitan": conversaciones derivadas a un humano (HANDOFF).
 *  - 'unread'    → "Sin leer": el usuario actual nunca las abrió (readBy[userId] ausente).
 *  - 'leads'     → "Interesados": etiquetadas como lead/interesado.
 */
type InboxView = 'all' | 'attention' | 'unread' | 'leads';
const INBOX_VIEWS: readonly InboxView[] = ['all', 'attention', 'unread', 'leads'];
function normalizeView(v: unknown): InboxView {
  return (typeof v === 'string' && (INBOX_VIEWS as readonly string[]).includes(v)) ? (v as InboxView) : 'all';
}

/**
 * Etiquetas que marcan un "lead/interesado" para la vista 'leads'. Las tags se
 * guardan preservando el case original, y el filtro JSON de Postgres (array_contains)
 * es exacto, así que matcheamos las variantes de capitalización más comunes.
 */
const LEAD_TAG_VARIANTS = ['lead', 'Lead', 'LEAD', 'interesado', 'Interesado', 'INTERESADO'];

// Lee de forma segura el metadata (Json) como objeto tipado, preservando
// cualquier clave existente que no manejemos explícitamente.
function readMeta(value: Prisma.JsonValue | null | undefined): ConversationMeta {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) } as ConversationMeta;
  }
  return {};
}

// Canal efectivo a mostrar en el Inbox: si la conversación guarda un canal real
// en metadata (MESSENGER/VOICE que se persisten como WEBCHAT), se prioriza ese;
// si no, se usa el enum `channel` tal cual. No rompe conversaciones sin metadata.
function displayChannelFor(channel: string, metadata: Prisma.JsonValue | null | undefined): string {
  const meta = readMeta(metadata);
  return typeof meta.realChannel === 'string' && meta.realChannel ? meta.realChannel : channel;
}

/**
 * Aplica una mutación a `Conversation.metadata` de forma atómica.
 *
 * Corre dentro de una transacción y bloquea la fila con `SELECT ... FOR UPDATE`
 * (scopeada por negocio), re-lee el metadata fresco y recién ahí aplica el
 * cambio. Así dos escrituras concurrentes sobre la misma conversación (dos
 * agentes, dos tabs, reintentos) se serializan y no se pisan: sin esto, el
 * patrón leer-mutar-en-memoria-escribir pierde cambios (lost-update) — p. ej.
 * una nota interna o la marca de leído de otro agente podía desaparecer.
 * Mismo patrón que `services/gallery/config.ts::mutateGallery`.
 *
 * Devuelve `{ ok:false }` si la conversación no existe para ese negocio.
 */
async function mutateConversationMeta<T>(
  conversationId: string,
  businessId: string,
  mutate: (meta: ConversationMeta) => { meta: ConversationMeta; result: T },
): Promise<{ ok: true; result: T; metadata: Prisma.JsonValue } | { ok: false }> {
  // Solo metadata: el status NO se toca (los cambios de atención van por
  // `transitionAttention`, que escribe status + metadata juntos).
  const out = await mutateConversation<T>(conversationId, businessId, (cur) => {
    const { meta, result } = mutate(cur.meta as ConversationMeta);
    return { meta, result };
  });
  return out.ok ? { ok: true, result: out.result, metadata: out.metadata } : { ok: false };
}

/**
 * Metadata apta para el panel: saca secretos internos que NO deben viajar al
 * navegador del equipo (hoy `chatTokenHash`, el hash del token del widget web).
 */
function publicMetadata<T extends Prisma.JsonValue | null | undefined>(value: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'chatTokenHash' in (value as object)) {
    const { chatTokenHash: _hidden, ...rest } = value as Record<string, unknown>;
    return rest as unknown as T;
  }
  return value;
}

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, parseInt(req.query.pageSize as string) || 20);
    const status = req.query.status as string | undefined;
    const channel = req.query.channel as string | undefined;
    const view = normalizeView(req.query.view);
    // Búsqueda en servidor (nombre / teléfono / email del contacto): el cliente solo
    // tiene cargada una página, así que filtrar en el navegador no encuentra las demás.
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

    const where: Prisma.ConversationWhereInput = { businessId: req.auth!.businessId };
    if (channel) where.channel = channel as Prisma.ConversationWhereInput['channel'];
    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { contactPhone: { contains: search } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    // La vista define el estado cuando corresponde (attention = HANDOFF); si no,
    // respetamos el filtro de estado explícito que mande la UI.
    if (view === 'attention') {
      where.status = 'HANDOFF';
    } else if (status) {
      where.status = status as Prisma.ConversationWhereInput['status'];
    }

    // Filtros de vista que viven dentro de metadata (Json). Se combinan con AND.
    const viewAnd: Prisma.ConversationWhereInput[] = [];
    if (view === 'unread') {
      // "Sin leer" por agente: el usuario actual nunca la abrió (readBy[userId]
      // ausente o null). El refinamiento fino (último mensaje del cliente) lo
      // hace el cliente; esto acota a nivel de BD de forma paginable.
      viewAnd.push({ metadata: { path: ['readBy', req.auth!.userId], equals: Prisma.AnyNull } });
    }
    if (view === 'leads') {
      // Alguna de las etiquetas de lead/interesado (variantes de capitalización).
      viewAnd.push({
        OR: LEAD_TAG_VARIANTS.map((t) => ({ metadata: { path: ['tags'], array_contains: t } })),
      });
    }
    if (viewAnd.length) where.AND = viewAnd;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          bot: { select: { name: true, channel: true } },
          _count: { select: { messages: true } },
          messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { text: true, role: true, createdAt: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);

    // Exponemos `displayChannel` (canal efectivo) sin tocar `channel`, para no
    // romper a los consumidores actuales que leen el enum directamente.
    const data = conversations.map((c) => ({
      ...c,
      metadata: publicMetadata(c.metadata),
      displayChannel: displayChannelFor(c.channel, c.metadata),
    }));

    res.json({ data, total, page, pageSize });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Paginación de mensajes por cursor (opcional). Sin `limit` devuelve el hilo
    // completo como siempre. Con `limit` devuelve los N más recientes; `before` (id
    // de mensaje) trae los N anteriores a ese. Siempre en orden cronológico.
    const limitRaw = parseInt(req.query.limit as string);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : null;
    const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null;

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      include: {
        bot: { select: { name: true, channel: true } },
        messages: limit
          ? {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: limit + 1,
              ...(before ? { cursor: { id: before }, skip: 1 } : {}),
            }
          : { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    let messages = conversation.messages;
    let hasMoreMessages = false;
    if (limit) {
      hasMoreMessages = messages.length > limit;
      messages = messages.slice(0, limit).reverse();
    }
    res.json({
      ...conversation,
      metadata: publicMetadata(conversation.metadata),
      messages,
      ...(limit ? { hasMoreMessages } : {}),
      displayChannel: displayChannelFor(conversation.channel, conversation.metadata),
    });
  })
);

/**
 * Metadata que guardamos en el Message de una respuesta humana. El enum
 * MessageRole no tiene HUMAN (schema congelado), así que el rol sigue siendo BOT
 * y lo que distingue a un humano es `metadata.sender === 'human'`.
 */
interface HumanReplyMeta {
  sender: 'human';
  userId: string;
  userName?: string;
  deliveryStatus: 'pending' | DeliveryStatus;
  deliveryError?: string;
  providerMessageId?: string;
  deliveryAttempts: number;
  /** ISO de cuándo arrancó el intento (sirve para detectar un `pending` colgado). */
  deliveryStartedAt?: string;
  [key: string]: unknown;
}

/**
 * Entrega el mensaje al canal real y deja el resultado en `Message.metadata`.
 * Nunca lanza: si falla el update del resultado, igual devolvemos lo que pasó con
 * el envío (el humano tiene que saber si el cliente lo recibió o no).
 */
async function deliverAndRecord(
  conversation: { id: string; channel: string; contactPhone: string | null; metadata: Prisma.JsonValue | null; businessId: string },
  message: { id: string; text: string },
  baseMeta: HumanReplyMeta,
) {
  const result = await deliverToChannel(conversation, message.text, conversation.businessId);

  const { deliveryError: _prevError, providerMessageId: _prevId, ...rest } = baseMeta;
  const finalMeta: HumanReplyMeta = {
    ...rest,
    deliveryStatus: result.status,
    ...(result.error ? { deliveryError: result.error } : {}),
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
  };

  let saved: Prisma.JsonValue = finalMeta as unknown as Prisma.JsonValue;
  try {
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { metadata: finalMeta as unknown as Prisma.InputJsonObject },
      select: { metadata: true },
    });
    saved = updated.metadata ?? saved;
  } catch (err) {
    console.error('No se pudo registrar el resultado de entrega del mensaje:', (err as Error).message);
  }

  // Los otros agentes ven el cambio de estado (enviado/falló) sin recargar.
  getIO()?.to(`business:${conversation.businessId}`).emit('conversation:updated', {
    conversationId: conversation.id,
  });

  return { result, metadata: saved };
}

// Respuesta de un humano desde el Inbox. Guarda el mensaje (rol BOT + metadata
// sender='human') y DESPUÉS lo envía al cliente por el canal real de la
// conversación. Si el envío falla el mensaje queda guardado igual (el humano no
// pierde su texto): se responde 200 con deliveryStatus='failed' y el motivo.
// `Idempotency-Key` (opcional) evita el doble envío por doble click/reintento.
//
// Atención: responder PAUSA al bot (estado HUMANO) y saca la conversación de
// HANDOFF en la MISMA transacción (ver services/conversationState.ts). Pausa
// aunque la entrega falle: el humano ya la tomó; la UI marca que el cliente NO
// recibió el mensaje. Sobre una conversación CERRADA se rechaza con 409.
router.post(
  '/:id/reply',
  requireAuth,
  // Cada reply puede disparar un mensaje real (WhatsApp cobra por mensaje).
  tenantRateLimit({ name: 'conv-reply', max: 60 }),
  validate(replySchema),
  asyncHandler(async (req, res) => {
    const { text } = req.body;
    const { businessId, userId } = req.auth!;

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.status === 'CLOSED') return res.status(409).json(CLOSED_CONVERSATION_ERROR);

    // At-most-once: la clave se reserva ANTES de guardar/enviar. Un duplicado no
    // vuelve a mandar nada; la UI ya tiene la respuesta del primer request.
    const idemKey = readIdempotencyKey(req.header('Idempotency-Key'));
    const idemScope = idemKey ? `conv-reply:${conversation.id}:${idemKey}` : null;
    if (idemScope) {
      const claimed = await claimIdempotentKey(prisma, businessId, IDEMP_TYPE_MRGO, idemScope);
      if (!claimed) return res.json({ duplicate: true });
    }

    let message;
    let baseMeta: HumanReplyMeta;
    try {
      const author = await prisma.user.findFirst({
        where: { id: userId, businessId },
        select: { name: true },
      });

      // Estado + metadata de la conversación en una sola transacción (HUMANO).
      // Si se cerró justo ahora, se rechaza ANTES de guardar nada.
      const attention = await transitionAttention(conversation.id, businessId, {
        type: 'reply',
        userId,
        userName: author?.name ?? null,
      });
      if (!attention.ok) {
        if (idemScope) await releaseIdempotentKey(prisma, businessId, IDEMP_TYPE_MRGO, idemScope);
        return attention.reason === 'closed'
          ? res.status(409).json(CLOSED_CONVERSATION_ERROR)
          : res.status(404).json({ error: 'Conversation not found' });
      }

      baseMeta = {
        sender: 'human',
        userId,
        ...(author?.name ? { userName: author.name } : {}),
        deliveryStatus: 'pending',
        deliveryAttempts: 1,
        deliveryStartedAt: new Date().toISOString(),
      };

      message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'BOT',
          text,
          metadata: baseMeta as unknown as Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      // Todavía no salió nada al cliente: liberamos la clave para que el reintento
      // con la misma Idempotency-Key no quede bloqueado como duplicado.
      if (idemScope) await releaseIdempotentKey(prisma, businessId, IDEMP_TYPE_MRGO, idemScope);
      throw err;
    }

    getIO()?.to(`business:${conversation.businessId}`).emit('conversation:new-message', {
      conversationId: conversation.id,
      message,
    });

    const { result, metadata } = await deliverAndRecord(conversation, message, baseMeta);

    res.json({
      ...message,
      metadata,
      deliveryStatus: result.status,
      ...(result.error ? { deliveryError: result.error } : {}),
    });
  })
);

/** Un `pending` más viejo que esto se considera colgado (el envío tiene tope de 15 s). */
const STALE_PENDING_MS = 60_000;

// Reintenta el envío de una respuesta humana cuya entrega falló (no crea otro
// mensaje: reusa el existente). El paso failed -> pending es atómico, así que un
// doble click no manda dos veces. Un `pending` de más de 60 s se trata como
// `failed` (el proceso murió a mitad del envío).
router.post(
  '/:id/reply/:messageId/retry',
  requireAuth,
  tenantRateLimit({ name: 'conv-reply', max: 60 }),
  asyncHandler(async (req, res) => {
    const { businessId } = req.auth!;

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.status === 'CLOSED') return res.status(409).json(CLOSED_CONVERSATION_ERROR);

    const message = await prisma.message.findFirst({
      where: { id: req.params.messageId as string, conversationId: conversation.id, role: 'BOT' },
    });
    const prev = readMeta(message?.metadata) as Partial<HumanReplyMeta>;
    if (!message || prev.sender !== 'human') return res.status(404).json({ error: 'Message not found' });

    // ¿Desde qué estado se puede reintentar? failed, o pending colgado (lazy).
    let retryFrom: 'failed' | 'pending' | null = null;
    if (prev.deliveryStatus === 'failed') {
      retryFrom = 'failed';
    } else if (prev.deliveryStatus === 'pending') {
      const startedAt = Date.parse(prev.deliveryStartedAt ?? '') || message.createdAt.getTime();
      if (Date.now() - startedAt > STALE_PENDING_MS) retryFrom = 'pending';
    }
    if (!retryFrom) {
      const sending = prev.deliveryStatus === 'pending';
      return res.status(409).json({
        error: sending ? 'Este mensaje todavía se está enviando.' : 'Este mensaje no tiene un envío fallido para reintentar.',
        code: 'NOT_FAILED',
      });
    }

    // Tope de intentos: evita que un cliente que no responde (o un loop) dispare
    // envíos reales sin fin. El primer envío cuenta como intento 1.
    const attemptsSoFar = typeof prev.deliveryAttempts === 'number' ? prev.deliveryAttempts : 1;
    if (attemptsSoFar >= MAX_DELIVERY_ATTEMPTS) {
      return res.status(409).json({
        error: `Ya se intentó enviar este mensaje ${attemptsSoFar} veces. Revisá la conexión del canal o escribilo de nuevo como un mensaje nuevo.`,
        code: 'MAX_ATTEMPTS',
      });
    }

    const baseMeta: HumanReplyMeta = {
      sender: 'human',
      userId: typeof prev.userId === 'string' ? prev.userId : req.auth!.userId,
      ...(typeof prev.userName === 'string' ? { userName: prev.userName } : {}),
      deliveryStatus: 'pending',
      deliveryAttempts: attemptsSoFar + 1,
      deliveryStartedAt: new Date().toISOString(),
    };

    // Reserva atómica: solo UNA llamada concurrente logra tomar el reintento.
    const claimed = await prisma.message.updateMany({
      where: { id: message.id, conversationId: conversation.id, metadata: { path: ['deliveryStatus'], equals: retryFrom } },
      data: { metadata: baseMeta as unknown as Prisma.InputJsonObject },
    });
    if (claimed.count === 0) {
      return res.status(409).json({ error: 'Este mensaje ya se está reintentando.', code: 'NOT_FAILED' });
    }

    const { result, metadata } = await deliverAndRecord(conversation, message, baseMeta);

    res.json({
      ...message,
      metadata,
      deliveryStatus: result.status,
      ...(result.error ? { deliveryError: result.error } : {}),
    });
  })
);

// Cierra la conversación (OPEN o HANDOFF) y limpia el rastro de atención
// (botPaused / pausedBy / ...): una cerrada no queda "atendida" ni "esperando".
router.patch(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req, res) => {
    const outcome = await transitionAttention(req.params.id as string, req.auth!.businessId, { type: 'close' });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found or already closed' });

    getIO()?.to(`business:${req.auth!.businessId}`).emit('conversation:closed', {
      conversationId: req.params.id,
    });

    res.json({ success: true });
  })
);

// Asignar (o desasignar) la conversación a un miembro del equipo.
// Guardamos el id y el nombre dentro de metadata.assignedTo / assignedToName.
router.patch(
  '/:id/assign',
  requireAuth,
  validate(assignSchema),
  asyncHandler(async (req, res) => {
    const { assignedTo } = req.body as { assignedTo?: string | null };
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;

    // El miembro se valida fuera del lock (no depende del metadata).
    let member: { id: string; name: string } | null = null;
    if (assignedTo) {
      member = await prisma.teamMember.findFirst({
        where: { id: assignedTo, businessId },
        select: { id: true, name: true },
      });
      if (!member) return res.status(404).json({ error: 'Team member not found' });
    }

    const outcome = await mutateConversationMeta(conversationId, businessId, (meta) => {
      if (member) {
        meta.assignedTo = member.id;
        meta.assignedToName = member.name;
      } else {
        meta.assignedTo = null;
        meta.assignedToName = null;
      }
      return { meta, result: null };
    });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found' });

    getIO()?.to(`business:${businessId}`).emit('conversation:updated', {
      conversationId,
    });

    res.json({ metadata: publicMetadata(outcome.metadata) });
  })
);

// Reemplaza el conjunto de etiquetas (tags) de la conversación.
router.patch(
  '/:id/tags',
  requireAuth,
  validate(tagsSchema),
  asyncHandler(async (req, res) => {
    const { tags } = req.body as { tags: string[] };
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;

    // Normaliza: trim, elimina vacíos y duplicados (case-insensitive)
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const raw of tags) {
      const t = raw.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(t);
    }

    const outcome = await mutateConversationMeta(conversationId, businessId, (meta) => {
      meta.tags = clean;
      return { meta, result: null };
    });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found' });

    getIO()?.to(`business:${businessId}`).emit('conversation:updated', {
      conversationId,
    });

    res.json({ metadata: publicMetadata(outcome.metadata) });
  })
);

// Agrega una nota interna (privada del equipo) a la conversación.
router.post(
  '/:id/notes',
  requireAuth,
  validate(noteSchema),
  asyncHandler(async (req, res) => {
    const { text } = req.body as { text: string };
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;

    const author = await prisma.user.findFirst({
      where: { id: req.auth!.userId, businessId },
      select: { name: true },
    });

    const note: ConversationNote = {
      text,
      at: new Date().toISOString(),
      by: req.auth!.userId,
      byName: author?.name ?? undefined,
    };

    // El append lee las notas frescas dentro del lock: sin esto, dos notas casi
    // simultáneas se pisaban y una desaparecía.
    const outcome = await mutateConversationMeta(conversationId, businessId, (meta) => {
      meta.notes = [...(meta.notes ?? []), note].slice(-MAX_NOTES);
      return { meta, result: null };
    });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found' });

    getIO()?.to(`business:${businessId}`).emit('conversation:updated', {
      conversationId,
    });

    res.json({ note, metadata: publicMetadata(outcome.metadata) });
  })
);

// Marca la conversación como leída (guarda metadata.lastReadAt).
router.patch(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;
    const now = new Date().toISOString();

    // Lectura POR usuario dentro del lock: el merge del map readBy lee el estado
    // fresco, así la marca de otro agente no se pierde por una escritura concurrente.
    const outcome = await mutateConversationMeta(conversationId, businessId, (meta) => {
      meta.readBy = { ...(meta.readBy ?? {}), [req.auth!.userId]: now };
      meta.lastReadAt = now; // compat con lectura global previa
      return { meta, result: null };
    });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found' });

    res.json({ metadata: publicMetadata(outcome.metadata) });
  })
);

// Un agente "toma" la conversación: pasa a HUMANO (bot callado), saca la
// conversación de HANDOFF ("Te necesitan") y guarda quién la tomó y cuándo. Si ya
// la tiene OTRO agente responde 409 (TAKEN_BY_OTHER), salvo `?force=true` hecho
// por un ADMIN. Sobre una conversación cerrada responde 409.
router.post(
  '/:id/take',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;
    // `force` solo cuenta para ADMIN: un agente común no le saca el chat a otro.
    const force = req.query.force === 'true' && req.auth!.role === 'ADMIN';

    const agent = await prisma.user.findFirst({
      where: { id: req.auth!.userId, businessId },
      select: { name: true },
    });

    const outcome = await transitionAttention(conversationId, businessId, {
      type: 'take',
      userId: req.auth!.userId,
      userName: agent?.name ?? null,
      force,
    });
    if (!outcome.ok) {
      if (outcome.reason === 'closed') return res.status(409).json(CLOSED_CONVERSATION_ERROR);
      if (outcome.reason === 'taken_by_other') {
        const who = outcome.takenBy.name || 'otro agente';
        return res.status(409).json({
          error: `Ya la está atendiendo ${who}.`,
          code: 'TAKEN_BY_OTHER',
          takenBy: outcome.takenBy,
        });
      }
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ metadata: publicMetadata(outcome.metadata), status: outcome.status });
  })
);

// Devuelve la conversación al bot (lo opuesto a /take): BOT, sin rastro de quién
// la tenía ni de la espera. Una conversación cerrada no se reabre.
router.post(
  '/:id/release',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;

    const outcome = await transitionAttention(conversationId, businessId, { type: 'release' });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found' });

    res.json({ metadata: publicMetadata(outcome.metadata), status: outcome.status });
  })
);

// Copiloto del inbox: genera un resumen de la conversación + una respuesta
// sugerida para el agente humano (reusa el motor de IA del negocio). Es de solo
// lectura: no crea mensajes ni envía nada al cliente, solo devuelve texto para
// que el agente lo lea/edite. Gap de competencia "copiloto del agente".
router.post(
  '/:id/copilot',
  requireAuth,
  tenantRateLimit({ name: 'conv-copilot', max: 30 }),
  asyncHandler(async (req, res) => {
    try {
      const result = await generateCopilot(req.auth!.businessId, req.params.id as string);
      if (!result) return res.status(404).json({ error: 'Conversation not found' });
      res.json(result);
    } catch (err) {
      // Si no hay motor de IA disponible o el proveedor falla, no rompemos el
      // inbox: devolvemos 503 con un mensaje claro para la UI.
      console.error('Error generando copiloto de conversación:', (err as Error).message);
      res.status(503).json({ error: 'El copiloto de IA no está disponible en este momento.' });
    }
  })
);

// Lead scoring de intención de compra: la IA del negocio estima qué tan cerca de
// comprar/reservar está el cliente (temperatura CALIENTE/TIBIO/FRÍO + puntaje
// 0-100 + motivo). Es de solo lectura sobre los mensajes; el resultado se
// persiste en metadata.leadScore con el mismo lock que el resto del inbox, para
// mostrarlo como badge sin recalcular. Gap de competencia "lead scoring".
router.post(
  '/:id/lead-score',
  requireAuth,
  tenantRateLimit({ name: 'conv-lead-score', max: 30 }),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const conversationId = req.params.id as string;

    let score: LeadScore | null;
    try {
      score = await generateLeadScore(businessId, conversationId);
    } catch (err) {
      // Sin motor de IA o proveedor caído: no rompemos el inbox.
      console.error('Error calculando lead score:', (err as Error).message);
      return res.status(503).json({ error: 'El scoring de IA no está disponible en este momento.' });
    }
    if (!score) return res.status(404).json({ error: 'Conversation not found' });

    // Persistimos el resultado en metadata (con lock) para listarlo después.
    const outcome = await mutateConversationMeta(conversationId, businessId, (meta) => {
      meta.leadScore = score as LeadScore;
      return { meta, result: null };
    });
    if (!outcome.ok) return res.status(404).json({ error: 'Conversation not found' });

    getIO()?.to(`business:${businessId}`).emit('conversation:updated', {
      conversationId,
    });

    res.json(score);
  })
);

export const conversationsRouter = router;
