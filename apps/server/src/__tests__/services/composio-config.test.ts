/**
 * Pruebas del servicio de config de Composio (`src/services/composio/config.ts`):
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
import { getCmpStatus, saveCmpConfig, loadCmpConfig, disconnectCmp } from '../../services/composio/config';
import { encrypt } from '../../lib/crypto';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/composio/config', () => {
  it('getCmpStatus: no conectado sin Connection', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await getCmpStatus('biz_1')).toEqual({ connected: false, enabled: false });
  });

  it('getCmpStatus: conectado sin exponer la key', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { apiKeyEnc: encrypt('cmp_key_123'), enabled: true },
    });
    const status = await getCmpStatus('biz_1');
    expect(status).toEqual({ connected: true, enabled: true });
    expect(JSON.stringify(status)).not.toContain('cmp_key_123');
  });

  it('saveCmpConfig: crea la Connection y cifra la key (habilita por defecto)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: {} });

    await saveCmpConfig('biz_1', { apiKey: 'cmp_secreto' });

    const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
    expect(typeof data.apiKeyEnc).toBe('string');
    expect(data.apiKeyEnc).not.toContain('cmp_secreto');
    expect(data.enabled).toBe(true);
  });

  it('saveCmpConfig: toma el lock si ya existe (no crea otra)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { apiKeyEnc: encrypt('t'), enabled: true } });
    await saveCmpConfig('biz_1', { enabled: false });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).not.toHaveBeenCalled();
  });

  it('loadCmpConfig: descifra la key; null si corrupta', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: encrypt('cmp_abc'), enabled: true } });
    expect(await loadCmpConfig('biz_1')).toEqual({ apiKey: 'cmp_abc', enabled: true });

    mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: 'corrupto' } });
    expect(await loadCmpConfig('biz_1')).toBeNull();
  });

  it('disconnectCmp: limpia la config cuando existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    await disconnectCmp('biz_1');
    expect(prisma.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { config: {}, isActive: false } })
    );
  });
});
