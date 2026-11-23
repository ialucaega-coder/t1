/**
 * Libro de gasto de IA fuera del chatbot (`recordAiSpend` en services/ai/usage.ts):
 * el consumo del copiloto, lead score, analista y agentes de Mr Go suma en
 * `getSpendSince` y por lo tanto en el tope mensual.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = {
  $executeRaw: vi.fn(),
  connection: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};
vi.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    connection: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { cache, cacheKey } from '../../lib/cache';
import { currentMonthWindow, getSpendByBusinessSince, getSpendSince, recordAiSpend } from '../../services/ai/usage';
import { SpendCapError, enforceSpendCap } from '../../services/ai/spendCap';

const m = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const { month, since } = currentMonthWindow();

/** Configura la query del chat (messages.metadata.usage): vacía por defecto. */
function chatSpend(rows: unknown[] = []) {
  m(prisma.$queryRaw).mockResolvedValue(rows);
}

describe('recordAiSpend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    m(tx.connection.findFirst).mockResolvedValue(null);
  });

  it('estima el costo del usage y crea el libro del negocio (Connection AI_SPEND_LEDGER) con lock', async () => {
    // 1M in + 1M out de gpt-4o-mini = 0.75 USD
    await recordAiSpend('biz_1', { inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'gpt-4o-mini' }, 'copilot');

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // advisory lock
    expect(m(tx.connection.findFirst).mock.calls[0][0].where).toEqual({ businessId: 'biz_1', type: 'AI_SPEND_LEDGER' });
    const created = m(tx.connection.create).mock.calls[0][0].data;
    expect(created).toMatchObject({ type: 'AI_SPEND_LEDGER', businessId: 'biz_1', isActive: false });
    expect(created.config.months[month].costUsd).toBeCloseTo(0.75, 6);
    expect(created.config.months[month].bySource.copilot).toBeCloseTo(0.75, 6);
  });

  it('acumula en el mes y por fuente sobre un libro existente (sin pisar lo anterior)', async () => {
    m(tx.connection.findFirst).mockResolvedValue({
      id: 'l1',
      config: { months: { [month]: { costUsd: 1, bySource: { copilot: 0.4, mrgo: 0.6 } } } },
    });

    await recordAiSpend('biz_1', { costUsd: 0.5 }, 'mrgo');
    await recordAiSpend('biz_1', { costUsd: 0.25 }, 'lead-score');

    const first = m(tx.connection.update).mock.calls[0][0].data.config.months[month];
    expect(first.costUsd).toBeCloseTo(1.5, 6);
    expect(first.bySource).toMatchObject({ copilot: 0.4, mrgo: expect.closeTo(1.1, 6) });
    expect(tx.connection.create).not.toHaveBeenCalled();
    expect(m(tx.connection.update).mock.calls[0][0].where).toEqual({ id: 'l1' });
  });

  it('conserva solo los últimos 3 meses', async () => {
    m(tx.connection.findFirst).mockResolvedValue({
      id: 'l1',
      config: { months: { '2020-01': { costUsd: 9, bySource: {} }, '2020-02': { costUsd: 9, bySource: {} }, '2020-03': { costUsd: 9, bySource: {} } } },
    });

    await recordAiSpend('biz_1', { costUsd: 1 }, 'mrgo');

    const months = Object.keys(m(tx.connection.update).mock.calls[0][0].data.config.months);
    expect(months).toHaveLength(3);
    expect(months).toContain(month);
    expect(months).not.toContain('2020-01');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('ignora un costo inválido (%s): no abre transacción', async (costUsd) => {
    await recordAiSpend('biz_1', { costUsd }, 'mrgo');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('un usage sin tokens (costo 0) no escribe nada', async () => {
    await recordAiSpend('biz_1', { inputTokens: 0, outputTokens: 0, model: 'gpt-4o' }, 'copilot');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('NUNCA lanza: si la base falla se loguea y la feature que gastó sigue', async () => {
    m(prisma.$transaction).mockRejectedValueOnce(new Error('db caída'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(recordAiSpend('biz_1', { costUsd: 1 }, 'mrgo')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('invalida el estado cacheado del tope para que el próximo chequeo vea este gasto', async () => {
    const key = cacheKey('biz_1', 'ai-spend-status', 'cap');
    cache.set(key, { level: 'ok' }, 60_000);

    await recordAiSpend('biz_1', { costUsd: 1 }, 'mrgo');

    expect(cache.get(key)).toBeUndefined();
  });
});

describe('getSpendSince suma el libro fuera del chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('chat + libro del mes actual', async () => {
    // Chat: 1M output de gpt-4o-mini = 0.6 USD.
    chatSpend([{ model: 'gpt-4o-mini', input_tokens: 0n, output_tokens: 1_000_000n }]);
    m(prisma.connection.findFirst).mockResolvedValue({ config: { months: { [month]: { costUsd: 2.5, bySource: { mrgo: 2.5 } } } } });

    expect(await getSpendSince('biz_1', since)).toBeCloseTo(3.1, 6);
    expect(m(prisma.connection.findFirst).mock.calls[0][0].where).toEqual({ businessId: 'biz_1', type: 'AI_SPEND_LEDGER' });
  });

  it('no cuenta meses anteriores a `since`', async () => {
    chatSpend([]);
    m(prisma.connection.findFirst).mockResolvedValue({
      config: { months: { '2020-01': { costUsd: 99, bySource: {} }, [month]: { costUsd: 1, bySource: {} } } },
    });

    expect(await getSpendSince('biz_1', since)).toBeCloseTo(1, 6);
  });

  it('sin libro (negocio que nunca gastó fuera del chat) devuelve solo el chat', async () => {
    chatSpend([{ model: 'gpt-4o-mini', input_tokens: 0n, output_tokens: 1_000_000n }]);
    m(prisma.connection.findFirst).mockResolvedValue(null);

    expect(await getSpendSince('biz_1', since)).toBeCloseTo(0.6, 6);
  });

  it('un libro corrupto no rompe el cálculo', async () => {
    chatSpend([]);
    m(prisma.connection.findFirst).mockResolvedValue({ config: { months: { [month]: { costUsd: 'mucho' }, 'x': 5 } } });

    expect(await getSpendSince('biz_1', since)).toBe(0);
  });
});

describe('getSpendByBusinessSince (panel Super Admin) suma el libro de cada negocio', () => {
  it('suma chat + libro por negocio', async () => {
    vi.clearAllMocks();
    chatSpend([{ businessId: 'biz_1', model: 'gpt-4o-mini', input_tokens: 0n, output_tokens: 1_000_000n }]);
    m(prisma.connection.findMany).mockResolvedValue([
      { businessId: 'biz_1', config: { months: { [month]: { costUsd: 1, bySource: {} } } } },
      { businessId: 'biz_2', config: { months: { [month]: { costUsd: 4, bySource: {} } } } },
    ]);

    const map = await getSpendByBusinessSince(since);

    expect(map.get('biz_1')).toBeCloseTo(1.6, 6);
    expect(map.get('biz_2')).toBeCloseTo(4, 6);
  });
});

describe('el tope mensual ahora corta con gasto fuera del chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('un negocio que gasta solo en copiloto/mrgo (chat en 0) llega al tope y se corta', async () => {
    chatSpend([]);
    // 1er findFirst = config del tope; los siguientes = libro (ver mockImplementation por type).
    m(prisma.connection.findFirst).mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === 'AI_SPEND_CAP'
        ? { config: { capUsd: 10, alerts: { month: '', warned: false, blocked: false } } }
        : { config: { months: { [month]: { costUsd: 12, bySource: { mrgo: 12 } } } } },
    );
    m(tx.connection.findFirst).mockResolvedValue(null);
    m(prisma.user.findFirst).mockResolvedValue(null);

    await expect(enforceSpendCap('biz_1')).rejects.toBeInstanceOf(SpendCapError);
  });

  it('con gasto fuera del chat por debajo del tope no se corta', async () => {
    chatSpend([]);
    m(prisma.connection.findFirst).mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === 'AI_SPEND_CAP'
        ? { config: { capUsd: 10, alerts: { month: '', warned: false, blocked: false } } }
        : { config: { months: { [month]: { costUsd: 3, bySource: { mrgo: 3 } } } } },
    );

    await expect(enforceSpendCap('biz_1')).resolves.toBeUndefined();
  });
});
