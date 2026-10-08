/**
 * Pruebas del servicio de CRM de clientes (`src/services/clients/crm.ts`):
 * saneo del catálogo de etiquetas y de las anotaciones, carga/guardado sobre el
 * modelo Connection (type='CLIENT_CRM') y las mutaciones por cliente. Prisma se
 * mockea; el saneo es determinístico y defensivo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import {
  sanitizeTags,
  sanitizeCrm,
  loadClientCrm,
  saveTags,
  setClientTags,
  setClientNote,
  MAX_TAGS,
  MAX_TAG_LABEL_LEN,
  MAX_NOTE_LEN,
  MAX_TAGS_PER_CLIENT,
} from '../../services/clients/crm';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
});

describe('services/clients/crm sanitizeTags', () => {
  it('descarta etiquetas sin label, recorta y normaliza color inválido a slate', () => {
    const out = sanitizeTags([
      { label: 'VIP', color: 'blue' },
      { label: '   ', color: 'red' },
      { label: 'x'.repeat(MAX_TAG_LABEL_LEN + 10), color: 'galaxy' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: 'VIP', color: 'blue' });
    expect(out[1].label).toHaveLength(MAX_TAG_LABEL_LEN);
    expect(out[1].color).toBe('slate'); // color inválido → default
  });

  it('dedup por id y aplica el tope de cantidad', () => {
    const dupe = [
      { id: 'a', label: 'uno' },
      { id: 'a', label: 'repetida' },
    ];
    expect(sanitizeTags(dupe)).toHaveLength(1);

    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => ({ label: `t${i}` }));
    expect(sanitizeTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe('services/clients/crm sanitizeCrm', () => {
  it('filtra asignaciones a etiquetas inexistentes y descarta clientes sin nada', () => {
    const crm = sanitizeCrm({
      tags: [{ id: 't1', label: 'VIP' }],
      byClient: {
        c1: { tags: ['t1', 't-fantasma'], note: 'ok' },
        c2: { tags: ['t-fantasma'], note: '' }, // queda vacío → se descarta
        c3: { tags: [], note: '   ' }, // nota vacía tras trim → se descarta
      },
    });
    expect(crm.byClient.c1).toEqual({ tags: ['t1'], note: 'ok' });
    expect(crm.byClient.c2).toBeUndefined();
    expect(crm.byClient.c3).toBeUndefined();
  });

  it('recorta la nota y topea etiquetas por cliente', () => {
    const tags = Array.from({ length: MAX_TAGS_PER_CLIENT + 5 }, (_, i) => ({ id: `t${i}`, label: `t${i}` }));
    const crm = sanitizeCrm({
      tags,
      byClient: { c1: { tags: tags.map((t) => t.id), note: 'n'.repeat(MAX_NOTE_LEN + 100) } },
    });
    expect(crm.byClient.c1.tags).toHaveLength(MAX_TAGS_PER_CLIENT);
    expect(crm.byClient.c1.note).toHaveLength(MAX_NOTE_LEN);
  });
});

describe('services/clients/crm loadClientCrm', () => {
  it('sin registro → CRM vacío', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await loadClientCrm('biz_1')).toEqual({ tags: [], byClient: {} });
  });

  it('lee y sanea el config persistido', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { tags: [{ id: 't1', label: 'VIP', color: 'blue' }], byClient: { c1: { tags: ['t1'], note: 'x' } } },
    });
    const crm = await loadClientCrm('biz_1');
    expect(crm.tags).toHaveLength(1);
    expect(crm.byClient.c1).toEqual({ tags: ['t1'], note: 'x' });
  });
});

describe('services/clients/crm mutaciones', () => {
  it('saveTags crea la fila si no existe (type CLIENT_CRM)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });

    const crm = await saveTags('biz_9', [{ label: 'VIP', color: 'blue' }]);
    expect(crm.tags[0]).toMatchObject({ label: 'VIP', color: 'blue' });
    const createArg = mock(prisma.connection.create).mock.calls[0][0];
    expect(createArg.data.type).toBe('CLIENT_CRM');
  });

  it('setClientTags actualiza con bloqueo FOR UPDATE si ya existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({
      config: { tags: [{ id: 't1', label: 'VIP' }], byClient: {} },
    });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });

    const annotation = await setClientTags('biz_9', 'cli_1', ['t1']);
    expect(annotation.tags).toEqual(['t1']);
    expect(mock(prisma.$queryRaw)).toHaveBeenCalled();
    expect(mock(prisma.connection.update)).toHaveBeenCalled();
  });

  it('setClientNote preserva las etiquetas existentes del cliente', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({
      config: { tags: [{ id: 't1', label: 'VIP' }], byClient: { cli_1: { tags: ['t1'], note: '' } } },
    });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });

    const annotation = await setClientNote('biz_9', 'cli_1', 'llamar el lunes');
    expect(annotation).toEqual({ tags: ['t1'], note: 'llamar el lunes' });
  });

  it('setClientTags ignora etiquetas que no están en el catálogo', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({
      config: { tags: [{ id: 't1', label: 'VIP' }], byClient: {} },
    });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });

    const annotation = await setClientTags('biz_9', 'cli_1', ['t1', 't-fantasma']);
    expect(annotation.tags).toEqual(['t1']);
  });
});
