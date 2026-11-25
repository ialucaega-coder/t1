/** lib/api/clients: exportCsv con manejo de errores (401/403/server) y descarga diferida. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setToken = vi.fn();
vi.mock('@/lib/api/http-client', () => ({
  API_URL: 'http://api.test/api',
  httpClient: { getToken: () => 'tok', setToken: (...a: unknown[]) => setToken(...a), patch: vi.fn(), post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));

import { exportCsv } from '@/lib/api/clients';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const res = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  blob: async () => new Blob(['a,b']),
});

describe('lib/api/clients: exportCsv', () => {
  it('manda el token del cliente http', async () => {
    fetchMock.mockResolvedValue(res(403));
    await expect(exportCsv()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/clients/export/csv', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('403: error claro de permisos', async () => {
    fetchMock.mockResolvedValue(res(403));
    await expect(exportCsv()).rejects.toThrow('No tenés permiso para exportar los clientes.');
  });

  it('401: limpia el token (sesión vencida) y avisa', async () => {
    fetchMock.mockResolvedValue(res(401));
    await expect(exportCsv()).rejects.toThrow('Tu sesión venció');
    expect(setToken).toHaveBeenCalledWith(null);
  });

  it('otro error: usa el mensaje del server', async () => {
    fetchMock.mockResolvedValue(res(500, { error: 'Falló la base' }));
    await expect(exportCsv()).rejects.toThrow('Falló la base');
  });

  it('error de red: mensaje de conexión', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(exportCsv()).rejects.toThrow('No se pudo conectar');
  });

  it('descarga y revoca el objeto URL recién después de un rato', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fetchMock.mockResolvedValue(res(200));

    await exportCsv();

    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
