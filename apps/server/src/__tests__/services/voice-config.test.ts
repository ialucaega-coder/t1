/**
 * Pruebas del servicio de config de voz (`src/services/voice/config.ts`):
 * carga con defaults derivados del negocio y guardado atómico (merge del parche
 * sobre el config fresco leído dentro del lock, evitando lost-update).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    business: { findUnique: vi.fn() },
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { loadVoiceSettings, saveVoiceSettings, defaultVoiceSettings } from '../../services/voice/config';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma)
  );
  (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mock(prisma.business.findUnique).mockResolvedValue({ name: 'Barbería Sur' });
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/voice/config', () => {
  describe('loadVoiceSettings', () => {
    it('combina defaults (con nombre del negocio) y lo guardado', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { assistantName: 'Leo', enabled: false } });

      const cfg = await loadVoiceSettings('biz_1');

      expect(cfg.assistantName).toBe('Leo'); // guardado
      expect(cfg.enabled).toBe(false); // guardado
      expect(cfg.greeting).toContain('Barbería Sur'); // default derivado del negocio
    });
  });

  describe('saveVoiceSettings', () => {
    it('crea el registro cuando no existe y aplica el parche', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: defaultVoiceSettings('Barbería Sur') });

      const result = await saveVoiceSettings('biz_1', { assistantName: 'Leo' });

      expect(prisma.connection.create).toHaveBeenCalledTimes(1);
      expect(result.assistantName).toBe('Leo');
    });

    it('toma el lock y mergea sobre el config fresco (evita lost-update)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      // Otro guardado ya cambió el saludo; el nuestro solo toca assistantName.
      mock(prisma.connection.findUnique).mockResolvedValue({
        config: { greeting: 'Saludo nuevo del otro guardado' },
      });

      const result = await saveVoiceSettings('biz_1', { assistantName: 'Leo' });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).not.toHaveBeenCalled();
      expect(result.assistantName).toBe('Leo'); // parche
      expect(result.greeting).toBe('Saludo nuevo del otro guardado'); // no se pisó
    });

    it('isActive refleja el enabled resultante', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: {} });

      await saveVoiceSettings('biz_1', { enabled: false });

      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) })
      );
    });
  });
});
