/**
 * Tope mensual de gasto de IA (`services/ai/spendCap.ts`): niveles 80 %/100 %,
 * corte con SpendCapError, aviso único por mes y fail-open.
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
    connection: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { cache } from '../../lib/cache';
import { levelFor, getSpendStatus, enforceSpendCap, SpendCapError, setSpendCap } from '../../services/ai/spendCap';
import { currentMonthWindow } from '../../services/ai/usage';

const m = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Gasto de `usd` dólares vía gpt-4o-mini: 1M output = 0.6 USD. */
function spend(usd: number) {
  m(prisma.$queryRaw).mockResolvedValue([
    { model: 'gpt-4o-mini', input_tokens: 0n, output_tokens: BigInt(Math.round((usd / 0.6) * 1_000_000)) },
  ]);
}

describe('services/ai/spendCap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('levelFor: ok / warn al 80 % / blocked al 100 %', () => {
    expect(levelFor(5, null)).toBe('ok');
    expect(levelFor(7.9, 10)).toBe('ok');
    expect(levelFor(8, 10)).toBe('warn');
    expect(levelFor(10, 10)).toBe('blocked');
    expect(levelFor(12, 10)).toBe('blocked');
  });

  it('currentMonthWindow usa el mes de Argentina (UTC-3)', () => {
    // 1 nov 01:00 UTC = 31 oct 22:00 en Argentina → sigue siendo octubre.
    const w = currentMonthWindow(new Date('2026-11-01T01:00:00Z'));
    expect(w.month).toBe('2026-10');
    expect(w.since.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('sin tope no consulta el gasto', async () => {
    m(prisma.connection.findFirst).mockResolvedValue(null);
    const s = await getSpendStatus('b1');
    expect(s.level).toBe('ok');
    expect(s.capUsd).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await expect(enforceSpendCap('b1')).resolves.toBeUndefined();
  });

  it('alwaysSpend calcula el gasto aunque no haya tope (ratio null)', async () => {
    m(prisma.connection.findFirst).mockResolvedValue(null);
    spend(1.2);
    const s = await getSpendStatus('b1', true);
    expect(s.capUsd).toBeNull();
    expect(s.ratio).toBeNull();
    expect(s.spentUsd).toBeCloseTo(1.2, 3);
  });

  it('al 100 % corta con SpendCapError y avisa una sola vez', async () => {
    m(prisma.connection.findFirst).mockResolvedValue({ config: { capUsd: 10 } });
    spend(10.5);
    tx.connection.findFirst.mockResolvedValue({ id: 'c1', config: { capUsd: 10 } });
    m(prisma.user.findFirst).mockResolvedValue({ id: 'admin1' });

    await expect(enforceSpendCap('b1')).rejects.toBeInstanceOf(SpendCapError);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.connection.update).toHaveBeenCalledTimes(1);

    // segundo mensaje: sigue cortando, sin nuevo aviso
    await expect(enforceSpendCap('b1')).rejects.toBeInstanceOf(SpendCapError);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('al 80 % avisa pero NO corta', async () => {
    m(prisma.connection.findFirst).mockResolvedValue({ config: { capUsd: 10 } });
    spend(8.5);
    tx.connection.findFirst.mockResolvedValue({ id: 'c1', config: { capUsd: 10 } });
    m(prisma.user.findFirst).mockResolvedValue({ id: 'admin1' });

    await expect(enforceSpendCap('b1')).resolves.toBeUndefined();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('no re-avisa si la DB ya lo marcó este mes (otra instancia)', async () => {
    const { month } = currentMonthWindow();
    m(prisma.connection.findFirst).mockResolvedValue({ config: { capUsd: 10 } });
    spend(9);
    tx.connection.findFirst.mockResolvedValue({
      id: 'c1',
      config: { capUsd: 10, alerts: { month, warned: true, blocked: false } },
    });
    await enforceSpendCap('b1');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('fail-open: si la consulta falla, no corta', async () => {
    m(prisma.connection.findFirst).mockRejectedValue(new Error('db caída'));
    await expect(enforceSpendCap('b1')).resolves.toBeUndefined();
  });

  it('setSpendCap valida el rango y guarda', async () => {
    await expect(setSpendCap('b1', -1)).rejects.toThrow();
    await expect(setSpendCap('b1', 1e9)).rejects.toThrow();
    tx.connection.findFirst.mockResolvedValue(null);
    await setSpendCap('b1', 25);
    expect(tx.connection.create).toHaveBeenCalledTimes(1);
  });
});
