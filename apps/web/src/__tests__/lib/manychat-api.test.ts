/**
 * Pruebas del cliente de ManyChat (`src/lib/api/manychat.ts`):
 * verifica que cada función pegue al path correcto con el método correcto y
 * el body esperado. Se mockea `httpClient` para inspeccionar las llamadas sin
 * tocar la red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del cliente HTTP: controlamos get/post.
vi.mock('@/lib/api/http-client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import * as mcApi from '@/lib/api/manychat';
import { httpClient } from '@/lib/api/http-client';

const get = httpClient.get as unknown as ReturnType<typeof vi.fn>;
const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lib/api/manychat', () => {
  it('getMcStatus pega a GET /manychat/status', async () => {
    get.mockResolvedValue({ connected: false, enabled: false });

    const res = await mcApi.getMcStatus();

    expect(get).toHaveBeenCalledWith('/manychat/status');
    expect(res).toEqual({ connected: false, enabled: false });
  });

  it('connectMc pega a POST /manychat/connect con la apiKey', async () => {
    post.mockResolvedValue({ connected: true, enabled: true });

    await mcApi.connectMc('1234567:abcdef');

    expect(post).toHaveBeenCalledWith('/manychat/connect', { apiKey: '1234567:abcdef' });
  });

  it('disconnectMc pega a POST /manychat/disconnect', async () => {
    post.mockResolvedValue({ connected: false, enabled: false });

    const res = await mcApi.disconnectMc();

    expect(post).toHaveBeenCalledWith('/manychat/disconnect', {});
    expect(res).toEqual({ connected: false, enabled: false });
  });
});
