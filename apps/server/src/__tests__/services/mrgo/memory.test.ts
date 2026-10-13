/**
 * Pruebas de la memoria estructurada de Mr Go (`services/mrgo/memory.ts`):
 * saneo (topes de longitud y cantidad), construcción del prompt y persistencia
 * con merge parcial. Se mockea Prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => {
  const tx = {
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  };
  return {
    prisma: {
      connection: { findFirst: vi.fn() },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from '../../../lib/prisma';
import {
  sanitizeMemory,
  buildMemoryPrompt,
  loadMemory,
  saveMemory,
  MAX_FACTS,
  MAX_FACT_LEN,
} from '../../../services/mrgo/memory';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const tx = (prisma as unknown as { __tx: { connection: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } } }).__tx;
const BIZ = 'biz_1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeMemory', () => {
  it('recorta hechos vacíos y aplica el tope de cantidad', () => {
    const facts = Array.from({ length: MAX_FACTS + 10 }, (_, i) => `hecho ${i}`);
    const mem = sanitizeMemory({ profile: '  hola  ', facts: [...facts, '', '   '] });
    expect(mem.profile).toBe('hola');
    expect(mem.facts).toHaveLength(MAX_FACTS);
  });

  it('recorta la longitud de cada hecho', () => {
    const mem = sanitizeMemory({ facts: ['x'.repeat(MAX_FACT_LEN + 50)] });
    expect(mem.facts[0]).toHaveLength(MAX_FACT_LEN);
  });

  it('config inválida → memoria vacía', () => {
    expect(sanitizeMemory(null)).toEqual({ profile: '', facts: [] });
    expect(sanitizeMemory({ facts: 'no-es-array' })).toEqual({ profile: '', facts: [] });
  });
});

describe('buildMemoryPrompt', () => {
  it('vacía → string vacío (no ensucia el prompt)', () => {
    expect(buildMemoryPrompt({ profile: '', facts: [] })).toBe('');
  });

  it('incluye perfil y hechos cuando hay', () => {
    const p = buildMemoryPrompt({ profile: 'Barbería', facts: ['promo viernes'] });
    expect(p).toContain('PERFIL DEL NEGOCIO');
    expect(p).toContain('Barbería');
    expect(p).toContain('promo viernes');
  });
});

describe('loadMemory', () => {
  it('devuelve memoria vacía si no hay registro', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await loadMemory(BIZ)).toEqual({ profile: '', facts: [] });
  });

  it('sanea la config guardada', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { profile: 'X', facts: ['a', ''] } });
    expect(await loadMemory(BIZ)).toEqual({ profile: 'X', facts: ['a'] });
  });
});

describe('saveMemory', () => {
  it('crea el registro si no existe', async () => {
    tx.connection.findFirst.mockResolvedValue(null);

    const res = await saveMemory(BIZ, { profile: 'Nuevo', facts: ['f1'] });

    expect(res).toEqual({ profile: 'Nuevo', facts: ['f1'] });
    expect(tx.connection.create).toHaveBeenCalled();
  });

  it('merge parcial: actualizar solo facts conserva el profile previo', async () => {
    tx.connection.findFirst.mockResolvedValue({ id: 'conn_1' });
    tx.connection.findUnique.mockResolvedValue({ config: { profile: 'Previo', facts: ['viejo'] } });

    const res = await saveMemory(BIZ, { facts: ['nuevo'] });

    expect(res.profile).toBe('Previo'); // no se tocó
    expect(res.facts).toEqual(['nuevo']);
    expect(tx.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conn_1' } }),
    );
  });
});
