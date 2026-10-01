/**
 * Pruebas del servicio de config de Cal.com (`src/services/calcom/config.ts`):
 * estado sin exponer la key, guardado cifrado (FOR UPDATE), lectura descifrada
 * y desconexión. Prisma mockeado; el cifrado (lib/crypto) es real.
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
import { getCalcomStatus, saveCalcomConfig, loadCalcomConfig, disconnectCalcom } from '../../services/calcom/config';
import { encrypt } from '../../lib/crypto';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/calcom/config', () => {
  describe('getCalcomStatus', () => {
    it('no conectado cuando no hay Connection', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      expect(await getCalcomStatus('biz_1')).toEqual({ connected: false, enabled: false, eventTypeId: null });
    });

    it('conectado y sin exponer la key cuando hay apiKeyEnc', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { apiKeyEnc: encrypt('cal_live_x'), eventTypeId: 42, enabled: true },
      });
      const status = await getCalcomStatus('biz_1');
      expect(status).toEqual({ connected: true, enabled: true, eventTypeId: 42 });
      expect(JSON.stringify(status)).not.toContain('cal_live_x');
    });
  });

  describe('saveCalcomConfig', () => {
    it('crea la Connection y guarda la key cifrada + habilitada', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: {} });

      await saveCalcomConfig('biz_1', { apiKey: 'cal_live_secreta', eventTypeId: 7 });

      const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
      expect(typeof data.apiKeyEnc).toBe('string');
      expect(data.apiKeyEnc).not.toContain('cal_live_secreta'); // cifrada
      expect(data.eventTypeId).toBe(7);
      expect(data.enabled).toBe(true); // conectar habilita por defecto
    });

    it('toma el lock cuando la Connection ya existe (no crea otra)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { apiKeyEnc: encrypt('k'), enabled: true } });

      await saveCalcomConfig('biz_1', { eventTypeId: 9 });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).not.toHaveBeenCalled();
    });
  });

  describe('loadCalcomConfig', () => {
    it('devuelve la key descifrada', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { apiKeyEnc: encrypt('cal_abc'), eventTypeId: 3, enabled: true },
      });
      const cfg = await loadCalcomConfig('biz_1');
      expect(cfg).toEqual({ apiKey: 'cal_abc', eventTypeId: 3, enabled: true });
    });

    it('null cuando no está conectado', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: {} });
      expect(await loadCalcomConfig('biz_1')).toBeNull();
    });

    it('null (sin lanzar) cuando la key cifrada está corrupta', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: 'corrupta' } });
      expect(await loadCalcomConfig('biz_1')).toBeNull();
    });
  });

  describe('disconnectCalcom', () => {
    it('limpia la config cuando existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
      await disconnectCalcom('biz_1');
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: { config: {}, isActive: false } })
      );
    });

    it('no hace nada cuando no existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      await disconnectCalcom('biz_1');
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });
  });
});
