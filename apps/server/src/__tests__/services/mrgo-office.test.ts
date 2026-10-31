/**
 * Pruebas del estado persistente de la oficina (`services/mrgo/office.ts`):
 * saneo defensivo (claves válidas, dedup, orden canónico) + load/save sobre
 * Connection (type MRGO_OFFICE), con Prisma mockeado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const queryRaw = vi.fn();

vi.mock('../../lib/prisma', () => {
  const conn = {
    findFirst: (...a: unknown[]) => findFirst(...a),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
  };
  return {
    prisma: {
      connection: conn,
      $queryRaw: (...a: unknown[]) => queryRaw(...a),
      $transaction: (cb: (tx: unknown) => unknown) =>
        cb({ connection: conn, $queryRaw: (...a: unknown[]) => queryRaw(...a) }),
    },
  };
});

import { sanitizeOffice, loadOffice, saveOffice } from '../../services/mrgo/office';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('services/mrgo/office — sanitizeOffice', () => {
  it('descarta claves fuera del catálogo y deduplica, en orden canónico', () => {
    // 'ceo' va antes que 'ventas' en el catálogo; 'nope' no existe.
    const out = sanitizeOffice({ paused: ['ventas', 'nope', 'ceo', 'ventas'] });
    expect(out.paused).toEqual(['ceo', 'ventas']);
  });

  it('tolera entradas no válidas (no-objeto / sin paused / paused no-array)', () => {
    expect(sanitizeOffice(null).paused).toEqual([]);
    expect(sanitizeOffice({}).paused).toEqual([]);
    expect(sanitizeOffice({ paused: 'ventas' }).paused).toEqual([]);
    expect(sanitizeOffice([]).paused).toEqual([]);
  });

  it('sanea las posiciones: clave válida + x/y recortados a [0,100]', () => {
    const out = sanitizeOffice({
      paused: [],
      positions: {
        ventas: { x: 50, y: 60 },
        ceo: { x: -10, y: 140 }, // se recorta a 0 / 100
        nope: { x: 10, y: 10 }, // clave inválida → se descarta
        soporte: { x: 'a', y: 5 }, // x inválido → se descarta
      },
    });
    expect(out.positions).toEqual({ ventas: { x: 50, y: 60 }, ceo: { x: 0, y: 100 } });
  });

  it('positions vacío cuando no viene o no es objeto', () => {
    expect(sanitizeOffice({ paused: [] }).positions).toEqual({});
    expect(sanitizeOffice({ paused: [], positions: [] }).positions).toEqual({});
  });
});

describe('services/mrgo/office — loadOffice', () => {
  it('devuelve las pausas saneadas del Connection del negocio', async () => {
    findFirst.mockResolvedValue({ config: { paused: ['ventas', 'nope'] } });
    const out = await loadOffice('biz_1');
    expect(out.paused).toEqual(['ventas']);
    expect(findFirst).toHaveBeenCalledWith({ where: { businessId: 'biz_1', type: 'MRGO_OFFICE' }, orderBy: { id: 'asc' } });
  });

  it('devuelve vacío si no hay registro', async () => {
    findFirst.mockResolvedValue(null);
    const out = await loadOffice('biz_1');
    expect(out.paused).toEqual([]);
  });
});

describe('services/mrgo/office — saveOffice', () => {
  it('crea el Connection si no existe y devuelve el estado saneado', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'conn_new' });

    const out = await saveOffice('biz_1', { paused: ['ventas', 'ceo', 'nope'] });

    expect(out.paused).toEqual(['ceo', 'ventas']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
    const arg = create.mock.calls[0][0] as { data: { type: string; businessId: string; config: unknown } };
    expect(arg.data.type).toBe('MRGO_OFFICE');
    expect(arg.data.businessId).toBe('biz_1');
    expect(arg.data.config).toEqual({ paused: ['ceo', 'ventas'], positions: {} });
  });

  it('actualiza con FOR UPDATE si el Connection ya existe', async () => {
    findFirst.mockResolvedValue({ id: 'conn_1' });
    update.mockResolvedValue({ id: 'conn_1' });

    const out = await saveOffice('biz_1', { paused: ['cobros'] });

    expect(out.paused).toEqual(['cobros']);
    expect(queryRaw).toHaveBeenCalledTimes(1); // SELECT ... FOR UPDATE
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
