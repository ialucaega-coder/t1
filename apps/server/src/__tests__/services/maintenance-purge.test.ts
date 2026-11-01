/**
 * Purga por TTL de OTP vencidos y claves de idempotencia viejas
 * (`services/maintenance/purge.ts`). Prisma mockeado: se verifican los
 * parámetros de los DELETE, el corte por antigüedad y el aislamiento de errores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: { $executeRaw: vi.fn() },
}));

import { prisma } from '../../lib/prisma';
import {
  cuidCutoffId,
  purgeExpiredOtps,
  purgeOldIdempotencyKeys,
  runPurge,
} from '../../services/maintenance/purge';

const exec = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockResolvedValue(0);
});

afterEach(() => {
  delete process.env.IDEMPOTENCY_TTL_DAYS;
});

describe('cuidCutoffId', () => {
  it('ordena cronológicamente contra ids cuid reales', () => {
    const t = Date.UTC(2026, 9, 1);
    const cut = cuidCutoffId(t);
    const idDe = (ms: number) => 'c' + ms.toString(36).padStart(8, '0') + 'x'.repeat(15);
    expect(idDe(t - DAY) < cut).toBe(true);
    expect(idDe(t + DAY) < cut).toBe(false);
    expect(cut).toMatch(/^c[0-9a-z]{8}$/);
  });
});

describe('purgeExpiredOtps', () => {
  it('borra por tandas hasta que una devuelve menos que el tamaño de tanda', async () => {
    exec.mockResolvedValueOnce(1000).mockResolvedValueOnce(1000).mockResolvedValueOnce(7);
    expect(await purgeExpiredOtps()).toBe(2007);
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('con 0 candidatos hace una sola consulta', async () => {
    expect(await purgeExpiredOtps()).toBe(0);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('corta el vencimiento 1 h antes de "ahora"', async () => {
    const now = 1_800_000_000_000;
    await purgeExpiredOtps(now);
    const params = exec.mock.calls[0].slice(1) as unknown[];
    expect(params).toContain(now - 60 * 60 * 1000);
  });

  it('no entra en loop infinito: tope de tandas por corrida', async () => {
    exec.mockResolvedValue(1000);
    expect(await purgeExpiredOtps()).toBe(50_000);
    expect(exec).toHaveBeenCalledTimes(50);
  });
});

describe('purgeOldIdempotencyKeys', () => {
  it('usa 30 días por defecto y solo los tres scopes de idempotencia', async () => {
    const now = 1_800_000_000_000;
    await purgeOldIdempotencyKeys(now);
    const params = exec.mock.calls[0].slice(1) as unknown[];
    expect(params).toContainEqual(['ORDER_IDEMPOTENCY', 'TRANSACTION_IDEMPOTENCY', 'MRGO_IDEMPOTENCY']);
    expect(params).toContain(cuidCutoffId(now - 30 * DAY));
  });

  it('respeta IDEMPOTENCY_TTL_DAYS y ignora valores inválidos', async () => {
    const now = 1_800_000_000_000;
    process.env.IDEMPOTENCY_TTL_DAYS = '7';
    await purgeOldIdempotencyKeys(now);
    expect(exec.mock.calls[0].slice(1)).toContain(cuidCutoffId(now - 7 * DAY));

    exec.mockClear();
    process.env.IDEMPOTENCY_TTL_DAYS = 'abc';
    await purgeOldIdempotencyKeys(now);
    expect(exec.mock.calls[0].slice(1)).toContain(cuidCutoffId(now - 30 * DAY));
  });
});

describe('runPurge', () => {
  it('si una purga falla, la otra igual corre', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    exec.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(3);
    const out = await runPurge();
    expect(out).toEqual({ otps: 0, idempotency: 3 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
