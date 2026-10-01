/**
 * Pruebas del servicio de config de MercadoPago (`src/services/mercadopago/config.ts`):
 * estado sin exponer el token, guardado cifrado (FOR UPDATE), lectura descifrada
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
import { getMpStatus, saveMpConfig, loadMpConfig, disconnectMp } from '../../services/mercadopago/config';
import { encrypt } from '../../lib/crypto';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/mercadopago/config', () => {
  it('getMpStatus: no conectado sin Connection; moneda por defecto ARS', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await getMpStatus('biz_1')).toEqual({ connected: false, enabled: false, currency: 'ARS' });
  });

  it('getMpStatus: conectado sin exponer el token', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { accessTokenEnc: encrypt('APP_USR-123'), currency: 'MXN', enabled: true },
    });
    const status = await getMpStatus('biz_1');
    expect(status).toEqual({ connected: true, enabled: true, currency: 'MXN' });
    expect(JSON.stringify(status)).not.toContain('APP_USR-123');
  });

  it('saveMpConfig: crea la Connection y cifra el token (habilita por defecto)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: {} });

    await saveMpConfig('biz_1', { accessToken: 'APP_USR-secreto', currency: 'ARS' });

    const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
    expect(typeof data.accessTokenEnc).toBe('string');
    expect(data.accessTokenEnc).not.toContain('APP_USR-secreto');
    expect(data.currency).toBe('ARS');
    expect(data.enabled).toBe(true);
  });

  it('saveMpConfig: toma el lock si ya existe (no crea otra)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { accessTokenEnc: encrypt('t'), enabled: true } });
    await saveMpConfig('biz_1', { currency: 'BRL' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).not.toHaveBeenCalled();
  });

  it('loadMpConfig: descifra el token; null si corrupto', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { accessTokenEnc: encrypt('APP_USR-abc'), currency: 'ARS', enabled: true },
    });
    expect(await loadMpConfig('biz_1')).toEqual({ accessToken: 'APP_USR-abc', currency: 'ARS', enabled: true });

    mock(prisma.connection.findFirst).mockResolvedValue({ config: { accessTokenEnc: 'corrupto' } });
    expect(await loadMpConfig('biz_1')).toBeNull();
  });

  it('disconnectMp: limpia la config cuando existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    await disconnectMp('biz_1');
    expect(prisma.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { config: {}, isActive: false } })
    );
  });
});
