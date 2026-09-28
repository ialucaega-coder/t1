import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';

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
   * Canal real cuando no tiene enum propio en BotChannel (ej: 'MESSENGER' o
   * 'VOICE', que se persisten como WEBCHAT). Lo escribe el chatbot al crear la
   * conversación; el Inbox lo usa para mostrar/filtrar el canal correcto.
   */
  realChannel?: string;
  [key: string]: unknown;
}

/** Máximo de notas internas que guardamos por conversación (evita JSON gigante). */
const MAX_NOTES = 200;

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
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "conversations"
      WHERE id = ${conversationId} AND "businessId" = ${businessId}
      FOR UPDATE`;
    if (locked.length === 0) return { ok: false as const };

    const fresh = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const { meta: nextMeta, result } = mutate(readMeta(fresh?.metadata));

    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: { metadata: nextMeta as Prisma.InputJsonValue },
      select: { metadata: true },
    });
    return { ok: true as const, result, metadata: updated.metadata };
  });
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

    const where: Prisma.ConversationWhereInput = { businessId: req.auth!.businessId };
    if (status) where.status = status as Prisma.ConversationWhereInput['status'];
    if (channel) where.channel = channel as Prisma.ConversationWhereInput['channel'];

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
      displayChannel: displayChannelFor(c.channel, c.metadata),
    }));

    res.json({ data, total, page, pageSize });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
      include: {
        bot: { select: { name: true, channel: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json({
      ...conversation,
      displayChannel: displayChannelFor(conversation.channel, conversation.metadata),
    });
  })
);

router.post(
  '/:id/reply',
  requireAuth,
  validate(replySchema),
  asyncHandler(async (req, res) => {
    const { text } = req.body;

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, businessId: req.auth!.businessId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'BOT',
        text,
      },
    });

    if (conversation.status === 'HANDOFF') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN' },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    getIO()?.to(`business:${conversation.businessId}`).emit('conversation:new-message', {
      conversationId: conversation.id,
      message,
    });

    res.json(message);
  })
);

router.patch(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await prisma.conversation.updateMany({
      where: { id: req.params.id as string, businessId: req.auth!.businessId, status: 'OPEN' },
      data: { status: 'CLOSED' },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Conversation not found or already closed' });

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

    res.json({ metadata: outcome.metadata });
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

    res.json({ metadata: outcome.metadata });
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

    res.json({ note, metadata: outcome.metadata });
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

    res.json({ metadata: outcome.metadata });
  })
);

export const conversationsRouter = router;
