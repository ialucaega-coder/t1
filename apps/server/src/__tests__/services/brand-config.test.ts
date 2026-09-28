/**
 * Pruebas del servicio de Voz de Marca (`src/services/brand/config.ts`):
 * carga con defaults y guardado atómico (merge del parche sobre el config
 * fresco leído dentro del lock, evitando lost-update).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { loadBrandVoice, saveBrandVoice, DEFAULT_BRAND_VOICE } from '../../services/brand/config';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma)
  );
  (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/brand/config', () => {
  describe('loadBrandVoice', () => {
    it('devuelve los defaults cuando el negocio no tiene config', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      expect(await loadBrandVoice('biz_1')).toEqual(DEFAULT_BRAND_VOICE);
    });

    it('normaliza el config guardado (ignora tipos inválidos)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { tono: 'cercano', emojis: 'no-es-bool', publicoObjetivo: 123 },
      });
      const voice = await loadBrandVoice('biz_1');
      expect(voice.tono).toBe('cercano');
      expect(voice.emojis).toBe(DEFAULT_BRAND_VOICE.emojis); // fallback por tipo inválido
      expect(voice.publicoObjetivo).toBe(''); // fallback por tipo inválido
    });
  });

  describe('saveBrandVoice', () => {
    it('crea el registro cuando no existe y aplica el parche', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: DEFAULT_BRAND_VOICE });

      const result = await saveBrandVoice('biz_1', { tono: 'formal' });

      expect(prisma.connection.create).toHaveBeenCalledTimes(1);
      expect(result.tono).toBe('formal');
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conn_new' } })
      );
    });

    it('toma el lock y mergea sobre el config fresco (evita lost-update)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      // El config fresco (leído dentro del lock) ya tiene reglas escritas por otro guardado.
      mock(prisma.connection.findUnique).mockResolvedValue({
        config: { ...DEFAULT_BRAND_VOICE, reglas: 'no prometer descuentos' },
      });

      const result = await saveBrandVoice('biz_1', { tono: 'divertido' });

      // El lock se tomó y no se creó un registro nuevo.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).not.toHaveBeenCalled();
      // El parche se aplicó SIN pisar el campo que ya estaba en el config fresco.
      expect(result.tono).toBe('divertido');
      expect(result.reglas).toBe('no prometer descuentos');
    });
  });
});
