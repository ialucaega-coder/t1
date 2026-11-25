/**
 * Máquina de estados de atención (`services/conversationState.ts`): BOT /
 * ESPERANDO / HUMANO / CERRADA. Parte pura (applyAttentionEvent) + la
 * transición atómica con Prisma y socket mockeados.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    conversation: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
const emit = vi.fn();
const to = vi.fn(() => ({ emit }));
vi.mock('../../lib/socket', () => ({ getIO: vi.fn(() => ({ to })) }));

import { prisma } from '../../lib/prisma';
import {
  DEFAULT_HUMAN_IDLE_MS,
  DEFAULT_WAITING_MS,
  PAUSE_NOTICE_INTERVAL_MS,
  applyAttentionEvent,
  getAttentionState,
  isAttentionExpired,
  isBotSilenced,
  isPauseNoticeDue,
  stampPauseNotice,
  transitionAttention,
  type ConversationStatus,
} from '../../services/conversationState';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type Cur = { status: ConversationStatus; metadata: Record<string, unknown> };
const bot: Cur = { status: 'OPEN', metadata: {} };
const waiting = (since = ago(60_000)): Cur => ({ status: 'HANDOFF', metadata: { waitingSince: since } });
const human = (by = 'u1', last = ago(60_000)): Cur => ({
  status: 'OPEN',
  metadata: { botPaused: true, pausedBy: by, pausedByName: 'Ana', pausedAt: last, lastHumanAt: last },
});
const closed: Cur = { status: 'CLOSED', metadata: {} };

describe('estados derivados', () => {
  it('BOT / ESPERANDO / HUMANO / CERRADA', () => {
    expect(getAttentionState(bot)).toBe('BOT');
    expect(getAttentionState(waiting())).toBe('ESPERANDO');
    expect(getAttentionState(human())).toBe('HUMANO');
    expect(getAttentionState(closed)).toBe('CERRADA');
  });

  it('una conversación vieja HANDOFF + botPaused cuenta como HUMANO (ya la tomó alguien)', () => {
    expect(getAttentionState({ status: 'HANDOFF', metadata: { botPaused: true } })).toBe('HUMANO');
  });

  it('isBotSilenced: callado en ESPERANDO y HUMANO, activo en BOT', () => {
    expect(isBotSilenced(bot)).toBe(false);
    expect(isBotSilenced(waiting())).toBe(true);
    expect(isBotSilenced(human())).toBe(true);
  });
});

describe('applyAttentionEvent', () => {
  it('take desde ESPERANDO: pasa a OPEN + botPaused, limpia la espera y marca lastHumanAt', () => {
    const r = applyAttentionEvent({ ...waiting(), metadata: { ...waiting().metadata, handoffAckAt: ago(1) } }, { type: 'take', userId: 'u1', userName: 'Ana' }, NOW);

    expect(r.status).toBe('OPEN');
    expect(r.meta).toMatchObject({ botPaused: true, pausedBy: 'u1', pausedByName: 'Ana', lastHumanAt: new Date(NOW).toISOString() });
    expect(r.meta.waitingSince).toBeUndefined();
    expect(r.meta.handoffAckAt).toBeUndefined();
  });

  it('take sobre una conversación de OTRO agente se rechaza; con force pasa', () => {
    const denied = applyAttentionEvent(human('u9'), { type: 'take', userId: 'u1' }, NOW);
    expect(denied.failure).toEqual({ ok: false, reason: 'taken_by_other', takenBy: { id: 'u9', name: 'Ana' } });

    const forced = applyAttentionEvent(human('u9'), { type: 'take', userId: 'u1', force: true }, NOW);
    expect(forced.failure).toBeUndefined();
    expect(forced.meta.pausedBy).toBe('u1');
  });

  it('take del MISMO agente es idempotente: conserva pausedAt', () => {
    const r = applyAttentionEvent(human('u1', ago(5 * 60_000)), { type: 'take', userId: 'u1' }, NOW);
    expect(r.meta.pausedAt).toBe(ago(5 * 60_000));
    expect(r.meta.lastHumanAt).toBe(new Date(NOW).toISOString());
  });

  it('take sobre CERRADA se rechaza', () => {
    expect(applyAttentionEvent(closed, { type: 'take', userId: 'u1' }, NOW).failure).toMatchObject({ reason: 'closed' });
  });

  it('reply: conserva al primero que la tomó y refresca lastHumanAt', () => {
    const r = applyAttentionEvent(human('u9', ago(10 * 60_000)), { type: 'reply', userId: 'u1', userName: 'Otro' }, NOW);
    expect(r.meta).toMatchObject({ pausedBy: 'u9', pausedByName: 'Ana', pausedAt: ago(10 * 60_000), lastHumanAt: new Date(NOW).toISOString() });
  });

  it('reply desde ESPERANDO o BOT la toma (OPEN + botPaused) y sobre CERRADA se rechaza', () => {
    expect(applyAttentionEvent(waiting(), { type: 'reply', userId: 'u1' }, NOW)).toMatchObject({ status: 'OPEN', meta: { botPaused: true, pausedBy: 'u1' } });
    expect(applyAttentionEvent(bot, { type: 'reply', userId: 'u1' }, NOW).meta).toMatchObject({ botPaused: true, pausedBy: 'u1' });
    expect(applyAttentionEvent(closed, { type: 'reply', userId: 'u1' }, NOW).failure).toMatchObject({ reason: 'closed' });
  });

  it('release devuelve al bot y limpia todo; sobre BOT o CERRADA no escribe', () => {
    const r = applyAttentionEvent({ status: 'OPEN', metadata: { ...human().metadata, tags: ['x'] } }, { type: 'release' }, NOW);
    expect(r).toMatchObject({ write: true, status: 'OPEN', meta: { tags: ['x'] } });
    expect(applyAttentionEvent(bot, { type: 'release' }, NOW).write).toBe(false);
    expect(applyAttentionEvent(closed, { type: 'release' }, NOW).write).toBe(false);
  });

  it('close desde cualquier estado abierto limpia el rastro de atención; ya cerrada se rechaza', () => {
    for (const cur of [bot, waiting(), human()]) {
      const r = applyAttentionEvent(cur, { type: 'close' }, NOW);
      expect(r.status).toBe('CLOSED');
      expect(r.meta).toEqual({});
    }
    expect(applyAttentionEvent(closed, { type: 'close' }, NOW).failure).toMatchObject({ reason: 'closed' });
  });

  it('handoff: BOT pasa a HANDOFF con waitingSince; con ack deja la marca para no repetir el acuse', () => {
    const r = applyAttentionEvent(bot, { type: 'handoff', ack: true }, NOW);
    expect(r.status).toBe('HANDOFF');
    expect(r.meta).toMatchObject({ waitingSince: new Date(NOW).toISOString(), handoffAckAt: new Date(NOW).toISOString() });
    expect(applyAttentionEvent(bot, { type: 'handoff' }, NOW).meta.handoffAckAt).toBeUndefined();
  });

  it('handoff no pisa a un humano ni resucita una CERRADA; ya ESPERANDO no refresca la espera', () => {
    expect(applyAttentionEvent(human(), { type: 'handoff' }, NOW).write).toBe(false);
    expect(applyAttentionEvent(waiting(), { type: 'handoff' }, NOW).write).toBe(false);
    expect(applyAttentionEvent(closed, { type: 'handoff' }, NOW).failure).toMatchObject({ reason: 'closed' });
  });
});

describe('plazos (expire lazy)', () => {
  it('constantes documentadas: 30 min humano, 15 min esperando, aviso cada 10 min', () => {
    expect(DEFAULT_HUMAN_IDLE_MS).toBe(30 * 60_000);
    expect(DEFAULT_WAITING_MS).toBe(15 * 60_000);
    expect(PAUSE_NOTICE_INTERVAL_MS).toBe(10 * 60_000);
  });

  it('HUMANO vence a los 30 min sin respuesta humana (usa lastHumanAt, no updatedAt)', () => {
    expect(isAttentionExpired(human('u1', ago(31 * 60_000)), NOW)).toBe(true);
    expect(isAttentionExpired(human('u1', ago(29 * 60_000)), NOW)).toBe(false);
  });

  it('ESPERANDO vence a los 15 min sin que nadie tome', () => {
    expect(isAttentionExpired(waiting(ago(16 * 60_000)), NOW)).toBe(true);
    expect(isAttentionExpired(waiting(ago(14 * 60_000)), NOW)).toBe(false);
  });

  it('sin marca de tiempo (datos viejos) se considera vencido: vuelve el comportamiento previo', () => {
    expect(isAttentionExpired({ status: 'OPEN', metadata: { botPaused: true } }, NOW)).toBe(true);
    expect(isAttentionExpired({ status: 'HANDOFF', metadata: {} }, NOW)).toBe(true);
  });

  it('BOT y CERRADA nunca vencen', () => {
    expect(isAttentionExpired(bot, NOW)).toBe(false);
    expect(isAttentionExpired(closed, NOW)).toBe(false);
  });

  it('expire vuelve a BOT solo si realmente venció (se re-evalúa bajo el lock)', () => {
    expect(applyAttentionEvent(human('u1', ago(31 * 60_000)), { type: 'expire' }, NOW)).toMatchObject({ write: true, status: 'OPEN', meta: {} });
    expect(applyAttentionEvent(human('u1', ago(5 * 60_000)), { type: 'expire' }, NOW).write).toBe(false);
    expect(applyAttentionEvent(waiting(ago(20 * 60_000)), { type: 'expire' }, NOW)).toMatchObject({ write: true, status: 'OPEN' });
  });

  it('aviso de pausa: vence a los 10 min', () => {
    expect(isPauseNoticeDue({}, NOW)).toBe(true);
    expect(isPauseNoticeDue({ pauseNoticeAt: ago(5 * 60_000) }, NOW)).toBe(false);
    expect(isPauseNoticeDue({ pauseNoticeAt: ago(11 * 60_000) }, NOW)).toBe(true);
  });
});

describe('transitionAttention (atómica)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    m(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    m(prisma.conversation.update).mockImplementation(async ({ data }: { data: { status?: string; metadata: unknown } }) => ({
      status: data.status ?? 'OPEN',
      metadata: data.metadata,
    }));
  });

  it('escribe status + metadata en UN update dentro del lock y avisa al panel', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'HANDOFF', metadata: { waitingSince: ago(1000) } });

    const r = await transitionAttention('c1', 'biz_1', { type: 'take', userId: 'u1', userName: 'Ana' }, NOW);

    expect(r).toMatchObject({ ok: true, changed: true, state: 'HUMANO', status: 'OPEN' });
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
    expect(m(prisma.conversation.update).mock.calls[0][0].data).toMatchObject({ status: 'OPEN', metadata: { botPaused: true } });
    expect(to).toHaveBeenCalledWith('business:biz_1');
    expect(emit).toHaveBeenCalledWith('conversation:updated', { conversationId: 'c1' });
  });

  it('el lock va scopeado por conversación Y negocio; si no existe devuelve not_found sin escribir', async () => {
    m(prisma.$queryRaw).mockResolvedValue([]);

    const r = await transitionAttention('c_ajena', 'biz_1', { type: 'close' }, NOW);

    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(m(prisma.$queryRaw).mock.calls[0].slice(1)).toEqual(['c_ajena', 'biz_1']);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('un evento sin efecto (release sobre BOT) no escribe ni emite', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: {} });

    const r = await transitionAttention('c1', 'biz_1', { type: 'release' }, NOW);

    expect(r).toMatchObject({ ok: true, changed: false, state: 'BOT' });
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('devuelve el motivo del rechazo sin escribir (take de otro agente)', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: human('u9').metadata });

    const r = await transitionAttention('c1', 'biz_1', { type: 'take', userId: 'u1' }, NOW);

    expect(r).toMatchObject({ ok: false, reason: 'taken_by_other' });
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe('stampPauseNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    m(prisma.$queryRaw).mockResolvedValue([{ id: 'c1' }]);
    m(prisma.conversation.update).mockImplementation(async ({ data }: { data: { metadata: unknown } }) => ({ status: 'OPEN', metadata: data.metadata }));
  });

  it('marca el aviso la primera vez (conversación silenciada)', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: human().metadata });

    expect(await stampPauseNotice('c1', 'biz_1', NOW)).toBe(true);
    expect(m(prisma.conversation.update).mock.calls[0][0].data.metadata.pauseNoticeAt).toBe(new Date(NOW).toISOString());
  });

  it('no repite el aviso si hay uno de hace menos de 10 min (dos mensajes simultáneos)', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: { ...human().metadata, pauseNoticeAt: ago(60_000) } });

    expect(await stampPauseNotice('c1', 'biz_1', NOW)).toBe(false);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('no avisa si la conversación ya volvió al bot', async () => {
    m(prisma.conversation.findUnique).mockResolvedValue({ status: 'OPEN', metadata: {} });

    expect(await stampPauseNotice('c1', 'biz_1', NOW)).toBe(false);
  });
});
