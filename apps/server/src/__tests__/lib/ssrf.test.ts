/**
 * Pruebas del guard anti-SSRF (lib/ssrf.ts): clasificación de rangos privados y
 * validación de URLs salientes (esquema, IP literal y resolución DNS).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dns', () => ({
  default: { promises: { lookup: vi.fn() } },
  promises: { lookup: vi.fn() },
}));

import dns from 'dns';
import { isPrivateIp, assertSafePublicUrl } from '../../lib/ssrf';

const lookup = dns.promises.lookup as unknown as ReturnType<typeof vi.fn>;

describe('lib/ssrf — isPrivateIp', () => {
  it('marca como privados los rangos no ruteables', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('deja pasar IPs públicas', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('lib/ssrf — assertSafePublicUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rechaza esquemas no http(s)', async () => {
    await expect(assertSafePublicUrl('ftp://example.com')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rechaza IP literal de metadata de la nube sin resolver DNS', async () => {
    await expect(assertSafePublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject({ statusCode: 400 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rechaza localhost y dominios internos', async () => {
    await expect(assertSafePublicUrl('http://localhost:8080')).rejects.toMatchObject({ statusCode: 400 });
    await expect(assertSafePublicUrl('http://redis.internal')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rechaza un nombre DNS que resuelve a un rango privado', async () => {
    lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    await expect(assertSafePublicUrl('https://evil.example.com/hook')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('acepta un host que resuelve a una IP pública', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const u = await assertSafePublicUrl('https://hooks.example.com/endpoint');
    expect(u.hostname).toBe('hooks.example.com');
  });

  it('acepta una IP pública literal sin resolver DNS', async () => {
    const u = await assertSafePublicUrl('https://1.1.1.1/hook');
    expect(u.hostname).toBe('1.1.1.1');
    expect(lookup).not.toHaveBeenCalled();
  });
});
