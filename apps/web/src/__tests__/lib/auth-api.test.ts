/**
 * Pruebas del cliente de autenticación (`src/lib/api/auth.ts`), con foco en el
 * flujo de 2FA (TOTP):
 *  - `login` NO setea token cuando la API responde { twoFactorRequired: true }.
 *  - `login` SÍ setea token cuando la respuesta trae token.
 *  - las funciones 2FA pegan a los paths correctos.
 * Se mockea `httpClient` para inspeccionar las llamadas sin tocar la red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del cliente HTTP: controlamos post/get y espiamos setToken.
vi.mock('@/lib/api/http-client', () => ({
  httpClient: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    setToken: vi.fn(),
  },
}));

import * as authApi from '@/lib/api/auth';
import { httpClient } from '@/lib/api/http-client';

const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;
const get = httpClient.get as unknown as ReturnType<typeof vi.fn>;
const setToken = httpClient.setToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lib/api/auth — login', () => {
  it('NO setea token cuando la API pide 2FA (twoFactorRequired)', async () => {
    post.mockResolvedValue({ twoFactorRequired: true });

    const res = await authApi.login('a@b.com', 'secret');

    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'secret' });
    expect(setToken).not.toHaveBeenCalled();
    expect(res).toEqual({ twoFactorRequired: true });
  });

  it('setea token cuando la respuesta trae token', async () => {
    post.mockResolvedValue({ token: 'jwt_1', user: { id: 'u1' }, business: { id: 'b1' } });

    const res = await authApi.login('a@b.com', 'secret');

    expect(setToken).toHaveBeenCalledWith('jwt_1');
    expect(res.token).toBe('jwt_1');
  });

  it('incluye twoFactorCode en el body cuando se lo pasa (segundo paso)', async () => {
    post.mockResolvedValue({ token: 'jwt_2', user: { id: 'u1' }, business: { id: 'b1' } });

    await authApi.login('a@b.com', 'secret', '123456');

    expect(post).toHaveBeenCalledWith('/auth/login', {
      email: 'a@b.com',
      password: 'secret',
      twoFactorCode: '123456',
    });
    expect(setToken).toHaveBeenCalledWith('jwt_2');
  });
});

describe('lib/api/auth — funciones 2FA', () => {
  it('getTwoFactorStatus pega a GET /auth/2fa/status', async () => {
    get.mockResolvedValue({ enabled: true });

    const res = await authApi.getTwoFactorStatus();

    expect(get).toHaveBeenCalledWith('/auth/2fa/status');
    expect(res).toEqual({ enabled: true });
  });

  it('setupTwoFactor pega a POST /auth/2fa/setup', async () => {
    post.mockResolvedValue({ otpauthUri: 'otpauth://x', qrDataUrl: 'data:image/png;base64,xxx' });

    const res = await authApi.setupTwoFactor();

    expect(post).toHaveBeenCalledWith('/auth/2fa/setup', {});
    expect(res.qrDataUrl).toContain('data:image/png');
  });

  it('verifyTwoFactor pega a POST /auth/2fa/verify con el código', async () => {
    post.mockResolvedValue({ enabled: true });

    await authApi.verifyTwoFactor('654321');

    expect(post).toHaveBeenCalledWith('/auth/2fa/verify', { code: '654321' });
  });

  it('disableTwoFactor pega a POST /auth/2fa/disable con el código', async () => {
    post.mockResolvedValue({ enabled: false });

    await authApi.disableTwoFactor('654321');

    expect(post).toHaveBeenCalledWith('/auth/2fa/disable', { code: '654321' });
  });
});
