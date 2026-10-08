/**
 * Pruebas del servicio de Base de conocimiento / FAQ
 * (`src/services/faq/config.ts`): saneo de entradas, carga/guardado sobre el
 * modelo Connection (type='FAQ_KB') y armado del fragmento de prompt. Prisma se
 * mockea; el saneo es determinístico y defensivo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import {
  sanitizeFaqItems,
  loadFaqItems,
  saveFaqItems,
  buildFaqPrompt,
  MAX_FAQ_ITEMS,
  MAX_QUESTION_LEN,
  MAX_ANSWER_LEN,
} from '../../services/faq/config';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
});

describe('services/faq sanitizeFaqItems', () => {
  it('descarta entradas sin pregunta o sin respuesta', () => {
    const out = sanitizeFaqItems([
      { question: 'Hola?', answer: 'Chau' },
      { question: '', answer: 'sin pregunta' },
      { question: 'sin respuesta', answer: '   ' },
      { answer: 'falta pregunta' },
      null,
      'no-objeto',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe('Hola?');
    expect(out[0].answer).toBe('Chau');
  });

  it('recorta longitudes y hace trim', () => {
    const out = sanitizeFaqItems([
      { question: '  ' + 'q'.repeat(MAX_QUESTION_LEN + 50) + '  ', answer: 'a'.repeat(MAX_ANSWER_LEN + 50) },
    ]);
    expect(out[0].question).toHaveLength(MAX_QUESTION_LEN);
    expect(out[0].answer).toHaveLength(MAX_ANSWER_LEN);
  });

  it('reusa el id si vino, genera uno si no', () => {
    const out = sanitizeFaqItems([
      { id: 'abc', question: 'q1', answer: 'a1' },
      { question: 'q2', answer: 'a2' },
    ]);
    expect(out[0].id).toBe('abc');
    expect(out[1].id).toBeTruthy();
    expect(out[1].id).not.toBe('abc');
  });

  it('aplica el tope de cantidad', () => {
    const many = Array.from({ length: MAX_FAQ_ITEMS + 20 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    expect(sanitizeFaqItems(many)).toHaveLength(MAX_FAQ_ITEMS);
  });

  it('entrada no-array → lista vacía', () => {
    expect(sanitizeFaqItems(null)).toEqual([]);
    expect(sanitizeFaqItems({ items: [] })).toEqual([]);
  });
});

describe('services/faq loadFaqItems', () => {
  it('sin registro → lista vacía', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await loadFaqItems('biz_1')).toEqual([]);
  });

  it('lee y sanea el config persistido', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { items: [{ id: 'x', question: 'q', answer: 'a' }, { question: '', answer: 'descartar' }] },
    });
    const out = await loadFaqItems('biz_1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('x');
  });
});

describe('services/faq saveFaqItems', () => {
  it('crea la fila si no existe y devuelve la lista saneada', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });

    const out = await saveFaqItems('biz_9', [{ question: 'q1', answer: 'a1' }, { question: '', answer: 'x' }]);
    expect(out).toHaveLength(1);
    expect(mock(prisma.connection.create)).toHaveBeenCalled();
    const createArg = mock(prisma.connection.create).mock.calls[0][0];
    expect(createArg.data.type).toBe('FAQ_KB');
  });

  it('actualiza con bloqueo FOR UPDATE si ya existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });

    const out = await saveFaqItems('biz_9', [{ question: 'q1', answer: 'a1' }]);
    expect(out).toHaveLength(1);
    expect(mock(prisma.$queryRaw)).toHaveBeenCalled();
    expect(mock(prisma.connection.update)).toHaveBeenCalled();
    expect(mock(prisma.connection.create)).not.toHaveBeenCalled();
  });
});

describe('services/faq buildFaqPrompt', () => {
  it('lista vacía → fragmento vacío', () => {
    expect(buildFaqPrompt([])).toBe('');
  });

  it('arma el fragmento numerado con P/R', () => {
    const prompt = buildFaqPrompt([
      { id: '1', question: '¿Horario?', answer: '9 a 18' },
      { id: '2', question: '¿Envíos?', answer: 'Sí, CABA' },
    ]);
    expect(prompt).toContain('BASE DE CONOCIMIENTO DEL NEGOCIO');
    expect(prompt).toContain('1. P: ¿Horario?');
    expect(prompt).toContain('R: 9 a 18');
    expect(prompt).toContain('2. P: ¿Envíos?');
  });
});
