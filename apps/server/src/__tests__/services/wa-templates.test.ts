/**
 * Pruebas del servicio de Plantillas WhatsApp oficiales (HSM)
 * (`src/services/whatsapp/templates.ts`): helpers puros (parseVariableCount,
 * isValidTemplateName), carga con default vacío + orden por updatedAt, y la
 * mutación atómica con lock (crea el registro si no existe / toma el lock si ya
 * existe). Se mockea Prisma como en system-prompt.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  loadWaTemplates,
  mutateWaTemplates,
  parseVariableCount,
  isValidTemplateName,
  type WaTemplate,
} from '../../services/whatsapp/templates';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function makeTemplate(over: Partial<WaTemplate> = {}): WaTemplate {
  return {
    id: 't1',
    name: 'bienvenida',
    language: 'es_AR',
    category: 'MARKETING',
    status: 'DRAFT',
    body: 'Hola {{1}}',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma),
  );
  (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'conn_1' }]);
  mock(prisma.connection.update).mockResolvedValue({});
  mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });
});

describe('services/whatsapp/templates — helpers puros', () => {
  describe('parseVariableCount', () => {
    it('devuelve 0 cuando no hay variables', () => {
      expect(parseVariableCount('Hola, gracias por tu compra')).toBe(0);
    });

    it('cuenta variables consecutivas desde 1', () => {
      expect(parseVariableCount('Hola {{1}}, tu pedido {{2}} llega el {{3}}')).toBe(3);
    });

    it('cuenta el máximo aunque se repitan', () => {
      expect(parseVariableCount('{{1}} {{2}} {{1}}')).toBe(2);
    });

    it('tira error si hay un salto en la numeración', () => {
      expect(() => parseVariableCount('Hola {{1}} y {{3}}')).toThrowError(/falta \{\{2\}\}/);
    });

    it('tira error si aparece {{0}}', () => {
      expect(() => parseVariableCount('Valor {{0}}')).toThrowError(/\{\{0\}\}/);
    });

    it('tira error si empieza en {{2}} (falta {{1}})', () => {
      expect(() => parseVariableCount('Solo {{2}}')).toThrowError(/falta \{\{1\}\}/);
    });
  });

  describe('isValidTemplateName', () => {
    it('acepta minúsculas, dígitos y guión bajo', () => {
      expect(isValidTemplateName('promo_oct_2026')).toBe(true);
    });

    it('rechaza mayúsculas, espacios y símbolos', () => {
      expect(isValidTemplateName('Promo Oct')).toBe(false);
      expect(isValidTemplateName('promo-oct')).toBe(false);
      expect(isValidTemplateName('')).toBe(false);
    });
  });
});

describe('services/whatsapp/templates — load/mutate', () => {
  describe('loadWaTemplates', () => {
    it('devuelve [] cuando el negocio no tiene registro', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      expect(await loadWaTemplates('biz_1')).toEqual([]);
    });

    it('devuelve las plantillas ordenadas por updatedAt desc', async () => {
      const vieja = makeTemplate({ id: 'vieja', updatedAt: '2026-01-01T00:00:00.000Z' });
      const nueva = makeTemplate({ id: 'nueva', updatedAt: '2026-10-10T00:00:00.000Z' });
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { templates: [vieja, nueva] } });

      const result = await loadWaTemplates('biz_1');
      expect(result.map((t) => t.id)).toEqual(['nueva', 'vieja']);
    });

    it('normaliza config inválido a []', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { templates: 'no-es-array' } });
      expect(await loadWaTemplates('biz_1')).toEqual([]);
    });
  });

  describe('mutateWaTemplates', () => {
    it('crea el registro cuando no existe (sin tomar lock)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { templates: [] } });

      const result = await mutateWaTemplates('biz_1', (templates) => {
        const tpl = makeTemplate();
        return { templates: [...templates, tpl], result: tpl };
      });

      expect(prisma.connection.create).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.connection.update).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('t1');
      // Persiste el array completo bajo { templates }.
      const calls = (prisma.connection.update as ReturnType<typeof vi.fn>).mock.calls as unknown as unknown[][];
      const data = (calls[0][0] as { data: { config: { templates: WaTemplate[] } } }).data;
      expect(data.config.templates).toHaveLength(1);
    });

    it('toma el lock y re-lee fresco cuando el registro ya existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { templates: [makeTemplate()] } });

      const result = await mutateWaTemplates('biz_1', (templates) => ({
        templates,
        result: templates.length,
      }));

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).not.toHaveBeenCalled();
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conn_1' } }),
      );
      expect(result).toBe(1);
    });
  });
});
