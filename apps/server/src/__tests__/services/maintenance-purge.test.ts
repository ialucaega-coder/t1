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
  purgeOldMercadoPagoRows,
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

describe('purgeOldMercadoPagoRows', () => {
  /**
   * Emula el DELETE con filas en memoria: aplica los mismos criterios que el SQL
   * (type = ANY(tipos), isActive=false, id con formato cuid, id < corte), tomando
   * los parámetros en el orden en que se interpolan en la consulta.
   */
  function fakeTable(rows: { id: string; type: string; isActive: boolean; businessId: string }[]) {
    exec.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      expect(strings.join('?')).toContain('"isActive" = false');
      const [types, cutoff] = values as [string[], string];
      const doomed = rows.filter(
        (r) => types.includes(r.type) && !r.isActive && /^c[0-9a-z]{24}$/.test(r.id) && r.id < cutoff,
      );
      for (const r of doomed) rows.splice(rows.indexOf(r), 1);
      return doomed.length;
    });
    return rows;
  }
  const now = Date.UTC(2026, 10, 15);
  const idAt = (ms: number, tail = 'a') => 'c' + Math.floor(ms).toString(36).padStart(8, '0') + tail.repeat(16);
  const row = (id: string, type: string, extra: Partial<{ isActive: boolean; businessId: string }> = {}) =>
    ({ id, type, isActive: false, businessId: 'biz_1', ...extra });

  it('borra cobros y claves de pago de más de 180 días y conserva los recientes', async () => {
    const rows = fakeTable([
      row(idAt(now - 200 * DAY, 'a'), 'MERCADOPAGO_COBRO'),
      row(idAt(now - 200 * DAY, 'b'), 'MERCADOPAGO_PAYMENT'),
      row(idAt(now - 100 * DAY, 'c'), 'MERCADOPAGO_COBRO'), // un link pagado semanas después sigue reconocible
      row(idAt(now - 100 * DAY, 'd'), 'MERCADOPAGO_PAYMENT'),
      row(idAt(now - 1 * DAY, 'e'), 'MERCADOPAGO_COBRO'),
    ]);
    expect(await purgeOldMercadoPagoRows(now)).toBe(2);
    expect(rows.map((r) => r.id.slice(-1))).toEqual(['c', 'd', 'e']);
  });

  it('no toca otros tipos (ni la conexión real de MercadoPago ni otras idempotencias) aunque sean viejos', async () => {
    const rows = fakeTable([
      row(idAt(now - 400 * DAY, 'a'), 'MERCADOPAGO'), // la configuración real del negocio
      row(idAt(now - 400 * DAY, 'b'), 'ORDER_IDEMPOTENCY'),
      row(idAt(now - 400 * DAY, 'c'), 'MERCADOPAGO_COBRO', { isActive: true }),
      row('id-con-otro-formato', 'MERCADOPAGO_COBRO'),
    ]);
    expect(await purgeOldMercadoPagoRows(now)).toBe(0);
    expect(rows).toHaveLength(4);
  });

  it('aplica a todos los negocios por igual (la purga es global por TTL)', async () => {
    const rows = fakeTable([
      row(idAt(now - 300 * DAY, 'a'), 'MERCADOPAGO_COBRO', { businessId: 'biz_1' }),
      row(idAt(now - 300 * DAY, 'b'), 'MERCADOPAGO_COBRO', { businessId: 'biz_2' }),
      row(idAt(now - 10 * DAY, 'c'), 'MERCADOPAGO_COBRO', { businessId: 'biz_2' }),
    ]);
    expect(await purgeOldMercadoPagoRows(now)).toBe(2);
    expect(rows.map((r) => r.businessId)).toEqual(['biz_2']);
  });

  it('el corte es exactamente 180 días y solo toca los dos scopes de MercadoPago', async () => {
    await purgeOldMercadoPagoRows(now);
    const params = exec.mock.calls[0].slice(1) as unknown[];
    expect(params).toContainEqual(['MERCADOPAGO_COBRO', 'MERCADOPAGO_PAYMENT']);
    expect(params).toContain(cuidCutoffId(now - 180 * DAY));
  });
});

describe('runPurge', () => {
  it('si una purga falla, la otra igual corre', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    exec.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(3);
    const out = await runPurge();
    expect(out).toEqual({ otps: 0, idempotency: 3, mercadopago: 0 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
