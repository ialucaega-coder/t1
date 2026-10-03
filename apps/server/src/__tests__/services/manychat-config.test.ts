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
import {
  getMcStatus,
  saveMcConfig,
  loadMcConfig,
  disconnectMc,
  verifyMcWebhookToken,
  regenerateMcWebhookToken,
} from '../../services/manychat/config';
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

  it('getMcStatus: expone el webhookToken cuando existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { apiKeyEnc: encrypt('t'), enabled: true, webhookToken: 'tok_abc' },
    });
    const status = await getMcStatus('biz_1');
    expect(status).toEqual({ connected: true, enabled: true, webhookToken: 'tok_abc' });
  });

  it('saveMcConfig: genera un webhookToken al conectar', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: {} });

    await saveMcConfig('biz_1', { apiKey: 'mc_secreto' });

    const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
    expect(typeof data.webhookToken).toBe('string');
    expect(data.webhookToken.length).toBeGreaterThan(10);
  });

  it('saveMcConfig: no regenera el webhookToken si ya existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { apiKeyEnc: encrypt('t'), webhookToken: 'ya_existe' } });
    await saveMcConfig('biz_1', { apiKey: 'nueva_key' });
    const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
    expect(data.webhookToken).toBe('ya_existe');
  });

  it('verifyMcWebhookToken: true solo si coincide', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: encrypt('t'), webhookToken: 'secreto123' } });
    expect(await verifyMcWebhookToken('biz_1', 'secreto123')).toBe(true);
    expect(await verifyMcWebhookToken('biz_1', 'otro')).toBe(false);
    expect(await verifyMcWebhookToken('biz_1', undefined)).toBe(false);
  });

  it('verifyMcWebhookToken: false si no hay token guardado', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { apiKeyEnc: encrypt('t') } });
    expect(await verifyMcWebhookToken('biz_1', 'cualquiera')).toBe(false);
  });

  it('regenerateMcWebhookToken: rota el token si está conectado', async () => {
    mock(prisma.connection.findFirst)
      .mockResolvedValueOnce({ id: 'c1' }) // dentro de la transacción
      .mockResolvedValueOnce({ config: { apiKeyEnc: encrypt('t'), enabled: true, webhookToken: 'nuevo' } }); // getMcStatus final
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { apiKeyEnc: encrypt('t'), webhookToken: 'viejo' } });

    const status = await regenerateMcWebhookToken('biz_1');
    const data = mock(prisma.connection.update).mock.calls[0][0].data.config;
    expect(data.webhookToken).not.toBe('viejo');
    expect(typeof data.webhookToken).toBe('string');
    expect(status.connected).toBe(true);
  });

  it('regenerateMcWebhookToken: lanza si no está conectado', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    await expect(regenerateMcWebhookToken('biz_1')).rejects.toThrow();
  });
});
