/**
 * Pruebas del cliente HTTP (`src/lib/api/http-client.ts`): el núcleo por el que
 * pasan todas las llamadas a la API. Cubre el manejo del token (localStorage +
 * cookie espejo), los headers (Content-Type, Authorization y headers custom como
 * Idempotency-Key), el manejo de 401 (limpia token y redirige a /login), los
 * errores HTTP, el 204 (sin cuerpo) y los verbos get/post/put/patch/delete.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { HttpClient, API_URL } from '@/lib/api/http-client';

/** Construye una respuesta tipo fetch mínima. */
function res(body: unknown, { status = 200 }: { status?: number } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();
const originalLocation = window.location;

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '', protocol: 'http:' },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.location.href = '';
  // Limpia la cookie espejo entre tests.
  document.cookie = 'auth_token=; Path=/; Max-Age=0';
});

describe('lib/http-client', () => {
  describe('gestión del token', () => {
    it('setToken guarda en localStorage y en la cookie espejo', () => {
      const client = new HttpClient();
      client.setToken('jwt_123');

      expect(localStorage.getItem('auth_token')).toBe('jwt_123');
      expect(document.cookie).toContain('auth_token=jwt_123');
      expect(client.getToken()).toBe('jwt_123');
    });

    it('setToken(null) borra el token de localStorage', () => {
      const client = new HttpClient();
      client.setToken('jwt_123');
      client.setToken(null);

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(client.getToken()).toBeNull();
    });

    it('getToken cae a localStorage cuando el cliente no tiene token en memoria', () => {
      localStorage.setItem('auth_token', 'from_storage');
      const client = new HttpClient();

      expect(client.getToken()).toBe('from_storage');
    });
  });

  describe('headers', () => {
    it('no manda Authorization cuando no hay token', async () => {
      fetchMock.mockResolvedValue(res({ ok: true }));
      const client = new HttpClient();

      await client.get('/services');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Authorization']).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/services`, expect.any(Object));
    });

    it('agrega Authorization: Bearer cuando hay token', async () => {
      fetchMock.mockResolvedValue(res([]));
      const client = new HttpClient();
      client.setToken('jwt_abc');

      await client.get('/services');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['Authorization']).toBe('Bearer jwt_abc');
    });

    it('post fusiona headers custom (ej. Idempotency-Key) con los base', async () => {
      fetchMock.mockResolvedValue(res({ id: 't1' }, { status: 201 }));
      const client = new HttpClient();
      client.setToken('jwt_abc');

      await client.post('/transactions', { amount: 100 }, { 'Idempotency-Key': 'key-xyz' });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ amount: 100 }));
      expect(init.headers['Idempotency-Key']).toBe('key-xyz');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Authorization']).toBe('Bearer jwt_abc');
    });
  });

  describe('manejo de respuestas', () => {
    it('devuelve el JSON en una respuesta ok', async () => {
      fetchMock.mockResolvedValue(res([{ id: 's1' }]));
      const client = new HttpClient();

      await expect(client.get('/services')).resolves.toEqual([{ id: 's1' }]);
    });

    it('devuelve null en un 204 sin cuerpo', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } } as unknown as Response);
      const client = new HttpClient();

      await expect(client.delete('/services/s1')).resolves.toBeNull();
    });

    it('en 401 limpia el token, redirige a /login y lanza Unauthorized', async () => {
      fetchMock.mockResolvedValue(res({ error: 'no' }, { status: 401 }));
      const client = new HttpClient();
      client.setToken('jwt_abc');

      await expect(client.get('/services')).rejects.toThrow('Unauthorized');
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(window.location.href).toBe('/login');
    });

    it('lanza con el mensaje del body en un error HTTP', async () => {
      fetchMock.mockResolvedValue(res({ error: 'Nombre duplicado' }, { status: 400 }));
      const client = new HttpClient();

      await expect(client.post('/services', {})).rejects.toThrow('Nombre duplicado');
    });

    it('usa un mensaje de fallback cuando el body de error no es JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => { throw new Error('not json'); },
      } as unknown as Response);
      const client = new HttpClient();

      await expect(client.get('/services')).rejects.toThrow('Request failed');
    });
  });

  describe('timeout / resiliencia', () => {
    it('pasa un AbortSignal al fetch (para poder cancelar por timeout)', async () => {
      fetchMock.mockResolvedValue(res([]));
      const client = new HttpClient();

      await client.get('/services');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('convierte un AbortError en un mensaje claro de timeout', async () => {
      fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
      const client = new HttpClient();

      await expect(client.get('/services')).rejects.toThrow(/tardó demasiado/i);
    });

    it('propaga otros errores de red tal cual (no los enmascara como timeout)', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const client = new HttpClient();

      await expect(client.get('/services')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('verbos HTTP', () => {
    it('put manda method PUT y serializa el body', async () => {
      fetchMock.mockResolvedValue(res({ id: 's1' }));
      const client = new HttpClient();

      await client.put('/services/s1', { name: 'x' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API_URL}/services/s1`);
      expect(init.method).toBe('PUT');
      expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    });

    it('patch manda method PATCH', async () => {
      fetchMock.mockResolvedValue(res({ id: 's1' }));
      const client = new HttpClient();

      await client.patch('/services/s1', { name: 'y' });

      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    });

    it('delete manda method DELETE sin body', async () => {
      fetchMock.mockResolvedValue(res(null, { status: 204 }));
      const client = new HttpClient();

      await client.delete('/services/s1');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
    });
  });
});
