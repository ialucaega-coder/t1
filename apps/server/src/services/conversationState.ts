/**
 * Máquina de estados de ATENCIÓN de una conversación (bot vs humano).
 *
 * El schema está congelado: no hay una columna "quién atiende". El estado se
 * deriva de `Conversation.status` (OPEN | HANDOFF | CLOSED) + flags en
 * `Conversation.metadata`. Para que nunca queden combinaciones contradictorias
 * (p. ej. pausada + HANDOFF), TODA transición pasa por `transitionAttention`,
 * que toma un `SELECT ... FOR UPDATE` de la fila (scopeado por negocio) y escribe
 * `status` + `metadata` en LA MISMA transacción.
 *
 * ┌───────────┬────────────────────────────┬───────────────────────────────────┐
 * │ Estado    │ Representación             │ ¿Responde el bot?                 │
 * ├───────────┼────────────────────────────┼───────────────────────────────────┤
 * │ BOT       │ OPEN, sin botPaused        │ Sí                                │
 * │ ESPERANDO │ HANDOFF, sin botPaused     │ No (esperando que alguien tome)   │
 * │ HUMANO    │ OPEN + botPaused=true      │ No (un agente la atiende)         │
 * │ CERRADA   │ CLOSED                     │ — (no se reabre sola)             │
 * └───────────┴────────────────────────────┴───────────────────────────────────┘
 *
 * Transiciones (evento → efecto):
 *   take    BOT/ESPERANDO/HUMANO → HUMANO. Si ya la tiene OTRO agente → rechazada
 *           (`taken_by_other`) salvo `force` (lo habilita la ruta solo para ADMIN).
 *   reply   BOT/ESPERANDO/HUMANO → HUMANO. Conserva al primero que la tomó y
 *           refresca `lastHumanAt`. Sobre CERRADA → rechazada (`closed`).
 *   release HUMANO/ESPERANDO → BOT ("devolver al bot"). Sobre CERRADA no hace nada.
 *   handoff BOT → ESPERANDO (el bot o una automatización derivó). Si ya está
 *           ESPERANDO/HUMANO no hace nada; sobre CERRADA se rechaza (no resucita).
 *   close   BOT/ESPERANDO/HUMANO → CERRADA y limpia TODO el rastro de atención.
 *   expire  HUMANO/ESPERANDO → BOT, solo si el plazo realmente venció (se
 *           re-evalúa bajo el lock, así un agente que respondió justo antes gana).
 *
 * Plazos (lazy: se evalúan cuando llega un mensaje del cliente, no hay sweeper):
 *   HUMANO    vence a los DEFAULT_HUMAN_IDLE_MS sin respuesta humana (`lastHumanAt`).
 *   ESPERANDO vence a los DEFAULT_WAITING_MS sin que nadie la tome (`waitingSince`).
 * NO se usa `Conversation.updatedAt`: el bot lo toca en cada respuesta.
 *
 * Claves en `Conversation.metadata` que maneja este módulo:
 *   botPaused, pausedBy, pausedByName, pausedAt  — quién la tomó (HUMANO)
 *   lastHumanAt   — ISO de la última acción humana (take / reply)
 *   waitingSince  — ISO de cuándo pasó a ESPERANDO
 *   handoffAckAt  — ISO del acuse enviado al cliente al derivar (se manda UNA vez)
 *   pauseNoticeAt — ISO del último aviso de pausa a canales síncronos (throttle)
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';

export type ConversationStatus = 'OPEN' | 'HANDOFF' | 'CLOSED';
export type AttentionState = 'BOT' | 'ESPERANDO' | 'HUMANO' | 'CERRADA';

/**
 * Una conversación HUMANO sin acción humana por este tiempo vuelve al bot.
 * DECISIÓN DEL DUEÑO PENDIENTE: por ahora fijo para todos los negocios (no
 * configurable); si hace falta, pasar a configuración por negocio.
 */
export const DEFAULT_HUMAN_IDLE_MS = 30 * 60 * 1000;

/**
 * Una conversación ESPERANDO (derivada) que nadie toma en este tiempo vuelve al
 * bot. Misma decisión pendiente que `DEFAULT_HUMAN_IDLE_MS`.
 */
export const DEFAULT_WAITING_MS = 15 * 60 * 1000;

/** Mínimo entre dos avisos de pausa al cliente en canales síncronos (widget, voz, ManyChat). */
export const PAUSE_NOTICE_INTERVAL_MS = 10 * 60 * 1000;

/** Forma mínima de conversación que necesitan las consultas de estado. */
export interface AttentionSubject {
  status: string;
  metadata: unknown;
}

type Meta = Record<string, unknown>;

function readMeta(value: unknown): Meta {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Meta) } : {};
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** Estado de atención derivado de status + metadata. */
export function getAttentionState(conv: AttentionSubject): AttentionState {
  if (conv.status === 'CLOSED') return 'CERRADA';
  // botPaused manda: una conversación vieja HANDOFF + botPaused ya la tomó un humano.
  if (readMeta(conv.metadata).botPaused === true) return 'HUMANO';
  if (conv.status === 'HANDOFF') return 'ESPERANDO';
  return 'BOT';
}

/**
 * ¿El bot debe quedarse callado? Sí cuando espera a un humano (HANDOFF) o un
 * humano la tiene (botPaused). Reemplaza al viejo `isBotPaused` (solo miraba el flag).
 */
export function isBotSilenced(conv: AttentionSubject): boolean {
  const state = getAttentionState(conv);
  return state === 'ESPERANDO' || state === 'HUMANO';
}

/**
 * ¿Venció el plazo de la atención actual? Sin marca de tiempo (datos viejos) se
 * considera vencido: es el comportamiento previo (el bot respondía igual).
 */
export function isAttentionExpired(conv: AttentionSubject, now: number): boolean {
  const meta = readMeta(conv.metadata);
  const state = getAttentionState(conv);
  if (state === 'HUMANO') {
    const last = parseTime(meta.lastHumanAt) ?? parseTime(meta.pausedAt);
    return last === null || now - last > DEFAULT_HUMAN_IDLE_MS;
  }
  if (state === 'ESPERANDO') {
    const since = parseTime(meta.waitingSince);
    return since === null || now - since > DEFAULT_WAITING_MS;
  }
  return false;
}

/** ¿Toca avisar al cliente (canal síncrono) que una persona lo atiende? */
export function isPauseNoticeDue(metadata: unknown, now: number): boolean {
  const last = parseTime(readMeta(metadata).pauseNoticeAt);
  return last === null || now - last >= PAUSE_NOTICE_INTERVAL_MS;
}

// ─── Transiciones ──────────────────────────────────────────────────────────

export type AttentionEvent =
  | { type: 'take'; userId: string; userName?: string | null; force?: boolean }
  | { type: 'release' }
  | { type: 'reply'; userId: string; userName?: string | null }
  | { type: 'close' }
  /** `ack`: el bot le está avisando al cliente en este mismo turno (queda marcado para no repetirlo). */
  | { type: 'handoff'; ack?: boolean }
  | { type: 'expire' };

export type TransitionFailure =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'closed' }
  | { ok: false; reason: 'taken_by_other'; takenBy: { id: string; name: string | null } };

export type TransitionResult =
  | { ok: true; changed: boolean; state: AttentionState; status: ConversationStatus; metadata: Prisma.JsonValue }
  | TransitionFailure;

const HUMAN_KEYS = ['botPaused', 'pausedBy', 'pausedByName', 'pausedAt', 'lastHumanAt'] as const;
const WAIT_KEYS = ['waitingSince', 'handoffAckAt'] as const;
const EPHEMERAL_KEYS = ['pauseNoticeAt'] as const;

function clearKeys(meta: Meta, keys: readonly string[]): void {
  for (const k of keys) delete meta[k];
}

/** Vuelve la metadata a "BOT": sin rastro de atención humana ni de espera. */
function resetToBot(meta: Meta): void {
  clearKeys(meta, HUMAN_KEYS);
  clearKeys(meta, WAIT_KEYS);
  clearKeys(meta, EPHEMERAL_KEYS);
}

interface Applied {
  write: boolean;
  status: ConversationStatus;
  meta: Meta;
  failure?: TransitionFailure;
}

/**
 * Función PURA: dado el estado actual y un evento, calcula el siguiente estado.
 * Separada del acceso a la base para poder razonar y testear la máquina sola.
 */
export function applyAttentionEvent(
  cur: { status: ConversationStatus; metadata: unknown },
  event: AttentionEvent,
  now: number,
): Applied {
  const meta = readMeta(cur.metadata);
  const nowIso = new Date(now).toISOString();
  const state = getAttentionState(cur);
  const noop: Applied = { write: false, status: cur.status, meta };

  switch (event.type) {
    case 'take': {
      if (state === 'CERRADA') return { ...noop, failure: { ok: false, reason: 'closed' } };
      const holder = typeof meta.pausedBy === 'string' && meta.pausedBy ? meta.pausedBy : null;
      if (meta.botPaused === true && holder && holder !== event.userId && !event.force) {
        const name = typeof meta.pausedByName === 'string' ? meta.pausedByName : null;
        return { ...noop, failure: { ok: false, reason: 'taken_by_other', takenBy: { id: holder, name } } };
      }
      const keepSince = meta.botPaused === true && holder === event.userId ? meta.pausedAt : undefined;
      meta.botPaused = true;
      meta.pausedBy = event.userId;
      meta.pausedByName = event.userName ?? null;
      meta.pausedAt = typeof keepSince === 'string' ? keepSince : nowIso;
      meta.lastHumanAt = nowIso;
      clearKeys(meta, WAIT_KEYS);
      clearKeys(meta, EPHEMERAL_KEYS);
      return { write: true, status: 'OPEN', meta };
    }

    case 'reply': {
      if (state === 'CERRADA') return { ...noop, failure: { ok: false, reason: 'closed' } };
      const holder = typeof meta.pausedBy === 'string' && meta.pausedBy ? meta.pausedBy : null;
      if (meta.botPaused !== true || !holder) {
        // Nadie la tenía: el que responde la toma. Si ya había un dueño, se conserva.
        meta.botPaused = true;
        meta.pausedBy = event.userId;
        meta.pausedByName = event.userName ?? null;
        meta.pausedAt = nowIso;
      }
      meta.lastHumanAt = nowIso;
      clearKeys(meta, WAIT_KEYS);
      clearKeys(meta, EPHEMERAL_KEYS);
      return { write: true, status: 'OPEN', meta };
    }

    case 'release': {
      if (state === 'CERRADA' || state === 'BOT') return noop;
      resetToBot(meta);
      return { write: true, status: 'OPEN', meta };
    }

    case 'close': {
      if (state === 'CERRADA') return { ...noop, failure: { ok: false, reason: 'closed' } };
      resetToBot(meta);
      return { write: true, status: 'CLOSED', meta };
    }

    case 'handoff': {
      if (state === 'CERRADA') return { ...noop, failure: { ok: false, reason: 'closed' } };
      if (state !== 'BOT') return noop; // ya espera o ya la tiene un humano
      clearKeys(meta, EPHEMERAL_KEYS);
      meta.waitingSince = nowIso;
      if (event.ack) meta.handoffAckAt = nowIso;
      else delete meta.handoffAckAt;
      return { write: true, status: 'HANDOFF', meta };
    }

    case 'expire': {
      if (!isBotSilenced(cur) || !isAttentionExpired(cur, now)) return noop;
      resetToBot(meta);
      return { write: true, status: 'OPEN', meta };
    }
  }
}

/**
 * Aplica una mutación a status + metadata de una conversación de forma atómica:
 * transacción + `SELECT ... FOR UPDATE` scopeado por negocio, relectura fresca y
 * escritura única. Dos escrituras concurrentes (dos agentes, bot vs humano) se
 * serializan y no se pisan. Si `write` es false no se escribe nada.
 *
 * Devuelve `{ ok:false }` si la conversación no existe para ese negocio.
 */
export async function mutateConversation<T>(
  conversationId: string,
  businessId: string,
  mutate: (cur: { status: ConversationStatus; meta: Meta }) => {
    meta: Meta;
    status?: ConversationStatus;
    write?: boolean;
    result: T;
  },
): Promise<{ ok: true; result: T; status: ConversationStatus; metadata: Prisma.JsonValue } | { ok: false }> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "conversations"
      WHERE id = ${conversationId} AND "businessId" = ${businessId}
      FOR UPDATE`;
    if (locked.length === 0) return { ok: false as const };

    const fresh = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, metadata: true },
    });
    const curStatus = (fresh?.status ?? 'OPEN') as ConversationStatus;
    const out = mutate({ status: curStatus, meta: readMeta(fresh?.metadata) });

    if (out.write === false) {
      return {
        ok: true as const,
        result: out.result,
        status: curStatus,
        metadata: (fresh?.metadata ?? null) as Prisma.JsonValue,
      };
    }

    const nextStatus = out.status ?? curStatus;
    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: out.meta as Prisma.InputJsonValue,
        ...(nextStatus !== curStatus ? { status: nextStatus } : {}),
      },
      select: { status: true, metadata: true },
    });
    return {
      ok: true as const,
      result: out.result,
      status: ((updated.status as ConversationStatus | undefined) ?? nextStatus) as ConversationStatus,
      metadata: updated.metadata,
    };
  });
}

function emitUpdated(businessId: string, conversationId: string): void {
  try {
    getIO()?.to(`business:${businessId}`).emit('conversation:updated', { conversationId });
  } catch {
    /* el socket es best-effort */
  }
}

/**
 * ÚNICO punto de entrada para cambiar quién atiende una conversación. Escribe
 * status + metadata en una sola transacción con lock y avisa al panel por socket
 * cuando algo cambió. `now` solo existe para poder testear los plazos.
 */
export async function transitionAttention(
  conversationId: string,
  businessId: string,
  event: AttentionEvent,
  now: number = Date.now(),
): Promise<TransitionResult> {
  const out = await mutateConversation<{ failure: TransitionFailure | null; changed: boolean }>(
    conversationId,
    businessId,
    (cur) => {
      const applied = applyAttentionEvent({ status: cur.status, metadata: cur.meta }, event, now);
      const changed = !applied.failure && applied.write;
      return {
        meta: applied.meta,
        status: applied.status,
        write: changed,
        result: { failure: applied.failure ?? null, changed },
      };
    },
  );

  if (!out.ok) return { ok: false, reason: 'not_found' };
  if (out.result.failure) return out.result.failure;

  if (out.result.changed) emitUpdated(businessId, conversationId);
  return {
    ok: true,
    changed: out.result.changed,
    state: getAttentionState({ status: out.status, metadata: out.metadata }),
    status: out.status,
    metadata: out.metadata,
  };
}

/**
 * Marca (bajo lock) que ya se le avisó al cliente que una persona lo atiende.
 * Devuelve true solo si la conversación sigue silenciada y el aviso estaba
 * vencido: así dos mensajes simultáneos no generan dos avisos.
 */
export async function stampPauseNotice(
  conversationId: string,
  businessId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const out = await mutateConversation<boolean>(conversationId, businessId, (cur) => {
    const subject = { status: cur.status, metadata: cur.meta };
    if (!isBotSilenced(subject) || !isPauseNoticeDue(cur.meta, now)) {
      return { meta: cur.meta, write: false, result: false };
    }
    cur.meta.pauseNoticeAt = new Date(now).toISOString();
    return { meta: cur.meta, write: true, result: true };
  });
  return out.ok ? out.result : false;
}
