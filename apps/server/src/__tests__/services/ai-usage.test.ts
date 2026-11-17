/**
 * Pruebas del FinOps de IA (`services/ai/usage.ts`): agrega el consumo de tokens
 * por día y por modelo, y estima el costo. La query de agregación (`$queryRaw`)
 * se mockea con filas crudas; se verifica la agregación y el costo en JS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from '../../lib/prisma';
import { getUsageSummary, estimateCostUsd } from '../../services/ai/usage';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('services/ai/usage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('estimateCostUsd usa el precio del modelo (gpt-4o-mini)', () => {
    // 1M input @0.15 + 1M output @0.60 = 0.75 USD
    expect(estimateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it('modelo desconocido cae al precio por defecto (1/3 por 1M)', () => {
    expect(estimateCostUsd('modelo-raro', 1_000_000, 0)).toBeCloseTo(1, 6);
  });

  it('agrega por día y por modelo con totales y costo', async () => {
    mock(prisma.$queryRaw).mockResolvedValue([
      { day: '2026-10-01', model: 'gpt-4o-mini', input_tokens: 1_000_000n, output_tokens: 1_000_000n, messages: 2n },
      { day: '2026-10-01', model: 'claude-3-5-haiku', input_tokens: 0n, output_tokens: 0n, messages: 1n },
      { day: '2026-10-02', model: 'gpt-4o-mini', input_tokens: 0n, output_tokens: 0n, messages: 3n },
    ]);

    const s = await getUsageSummary('biz_1', 14);

    expect(s.rangeDays).toBe(14);
    expect(s.totalInputTokens).toBe(1_000_000);
    expect(s.totalOutputTokens).toBe(1_000_000);
    expect(s.totalMessages).toBe(6);
    expect(s.estimatedCostUsd).toBeCloseTo(0.75, 4);

    // byDay: 2 días, el primero con el costo
    expect(s.byDay).toHaveLength(2);
    const d1 = s.byDay.find((d) => d.day === '2026-10-01')!;
    expect(d1.messages).toBe(3);
    expect(d1.estimatedCostUsd).toBeCloseTo(0.75, 4);

    // byModel: ordenado por costo desc → gpt-4o-mini primero
    expect(s.byModel[0].model).toBe('gpt-4o-mini');
    expect(s.byModel[0].messages).toBe(5);
  });

  it('acota el rango de días a [1,365]', async () => {
    mock(prisma.$queryRaw).mockResolvedValue([]);
    expect((await getUsageSummary('biz_1', 9999)).rangeDays).toBe(365);
    expect((await getUsageSummary('biz_1', 0)).rangeDays).toBe(30); // 0 → default 30
    expect((await getUsageSummary('biz_1', -5)).rangeDays).toBe(1);
  });
});
