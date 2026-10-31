/**
 * Pruebas del giro persistente de Mr Go (`services/mrgo/industry.ts`):
 * saneo defensivo (giroId solo del catálogo), load/save sobre Connection
 * (type MRGO_INDUSTRY) con Prisma mockeado, y el prompt de tono por giro.
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

import {
  sanitizeIndustry,
  loadIndustry,
  saveIndustry,
  buildIndustryPrompt,
} from '../../services/mrgo/industry';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('services/mrgo/industry — sanitizeIndustry', () => {
  it('acepta un giro del catálogo', () => {
    expect(sanitizeIndustry({ giroId: 'cafeteria' }).giroId).toBe('cafeteria');
  });

  it('descarta un giro fuera del catálogo o entradas inválidas', () => {
    expect(sanitizeIndustry({ giroId: 'inventado' }).giroId).toBe('');
    expect(sanitizeIndustry(null).giroId).toBe('');
    expect(sanitizeIndustry({}).giroId).toBe('');
    expect(sanitizeIndustry({ giroId: 123 }).giroId).toBe('');
    expect(sanitizeIndustry([]).giroId).toBe('');
  });
});

describe('services/mrgo/industry — loadIndustry', () => {
  it('devuelve el giro saneado del Connection', async () => {
    findFirst.mockResolvedValue({ config: { giroId: 'spa' } });
    const out = await loadIndustry('biz_1');
    expect(out.giroId).toBe('spa');
    expect(findFirst).toHaveBeenCalledWith({ where: { businessId: 'biz_1', type: 'MRGO_INDUSTRY' }, orderBy: { id: 'asc' } });
  });

  it('devuelve vacío si no hay registro', async () => {
    findFirst.mockResolvedValue(null);
    expect((await loadIndustry('biz_1')).giroId).toBe('');
  });
});

describe('services/mrgo/industry — saveIndustry', () => {
  it('crea el Connection si no existe', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'conn_new' });

    const out = await saveIndustry('biz_1', { giroId: 'restaurante' });

    expect(out.giroId).toBe('restaurante');
    expect(create).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
    const arg = create.mock.calls[0][0] as { data: { type: string; config: unknown } };
    expect(arg.data.type).toBe('MRGO_INDUSTRY');
    expect(arg.data.config).toEqual({ giroId: 'restaurante' });
  });

  it('actualiza con FOR UPDATE si el Connection ya existe', async () => {
    findFirst.mockResolvedValue({ id: 'conn_1' });
    update.mockResolvedValue({ id: 'conn_1' });

    const out = await saveIndustry('biz_1', { giroId: 'veterinaria' });

    expect(out.giroId).toBe('veterinaria');
    expect(queryRaw).toHaveBeenCalledTimes(1); // SELECT ... FOR UPDATE
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('services/mrgo/industry — buildIndustryPrompt', () => {
  it('arma el prompt de tono con el rubro elegido', () => {
    const out = buildIndustryPrompt('veterinaria');
    expect(out).toContain('RUBRO DEL NEGOCIO');
    expect(out).toContain('Veterinaria');
  });

  it('devuelve vacío si no hay giro o el id no existe', () => {
    expect(buildIndustryPrompt('')).toBe('');
    expect(buildIndustryPrompt('inventado')).toBe('');
  });
});
