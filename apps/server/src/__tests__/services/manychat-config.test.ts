/**
 * Pruebas del servicio de config de ManyChat (`src/services/manychat/config.ts`):
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
import { getMcStatus, saveMcConfig, loadMcConfig, disconnectMc } from '../../services/manychat/config';
import { encrypt } from '../../lib/crypto';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/manychat/config', () => {
  it('getMcStatus: no conectado sin Connection', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await getMcStatus('biz_1')).toEqual({ connected: false, enabled: false });
  });

  it('getMcStatus: conectado sin exponer la key', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { apiKeyEnc: encrypt('mc_token_123'), enabled: true },
    });
    const status = await getMcStatus('biz_1');
    expect(status).toEqual({ connected: true, enabled: true });
    expect(JSON.stringify(status)).not.toContain('mc_token_123');
  });

  it('saveMcConfig: crea la Connection y cifra la key (habilita por defecto)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: {} });

    await saveMcConfig('biz_1', { apiKey: 'mc_secreto' });

    const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
    expect(typeof data.apiKeyEnc).toBe('string');
    expect(data.apiKeyEnc).not.toContain('mc_secreto');
    expect(data.enabled).toBe(true);
  });

  it('saveMcConfig: toma el lock si ya existe (no crea otra)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { apiKeyEnc: encrypt('t'), enabled: true } });
    await saveMcConfig('biz_1', { enabled: false });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).not.toHaveBeenCalled();
  });

  it('loadMcConfig: descifra la key; null si corrupta', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: encrypt('mc_abc'), enabled: true } });
    expect(await loadMcConfig('biz_1')).toEqual({ apiKey: 'mc_abc', enabled: true });

    mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: 'corrupto' } });
    expect(await loadMcConfig('biz_1')).toBeNull();
  });

  it('disconnectMc: limpia la config cuando existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    await disconnectMc('biz_1');
    expect(prisma.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { config: {}, isActive: false } })
    );
  });
});
