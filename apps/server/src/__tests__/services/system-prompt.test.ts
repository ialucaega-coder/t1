/**
 * Pruebas del servicio de Prompt de Sistema custom
 * (`src/services/ai/system-prompt.ts`): carga con default vacío, normalización,
 * creación cuando no existe, guardado atómico con lock, y truncado al máximo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { loadSystemPrompt, saveSystemPrompt, MAX_SYSTEM_PROMPT_LENGTH } from '../../services/ai/system-prompt';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma)
  );
  (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
  mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });
});

describe('services/ai/system-prompt', () => {
  describe('loadSystemPrompt', () => {
    it('devuelve string vacío cuando el negocio no tiene prompt', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      expect(await loadSystemPrompt('biz_1')).toBe('');
    });

    it('devuelve el prompt guardado', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { prompt: 'Sé cálido' } });
      expect(await loadSystemPrompt('biz_1')).toBe('Sé cálido');
    });

    it('normaliza config inválido a string vacío', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { prompt: 123 } });
      expect(await loadSystemPrompt('biz_1')).toBe('');
    });
  });

  describe('saveSystemPrompt', () => {
    it('crea el registro cuando no existe (sin tomar lock ni update)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const result = await saveSystemPrompt('biz_1', 'Hola mundo');

      expect(prisma.connection.create).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.connection.update).not.toHaveBeenCalled();
      expect(result).toBe('Hola mundo');
    });

    it('toma el lock y actualiza cuando ya existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });

      const result = await saveSystemPrompt('biz_1', 'Nuevo prompt');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).not.toHaveBeenCalled();
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conn_1' } })
      );
      expect(result).toBe('Nuevo prompt');
    });

    it('trunca el prompt al máximo permitido', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      const long = 'x'.repeat(MAX_SYSTEM_PROMPT_LENGTH + 500);

      const result = await saveSystemPrompt('biz_1', long);

      expect(result).toHaveLength(MAX_SYSTEM_PROMPT_LENGTH);
    });
  });
});
