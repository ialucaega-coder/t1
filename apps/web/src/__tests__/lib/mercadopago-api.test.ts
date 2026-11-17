/**
 * Pruebas del cliente de MercadoPago (`src/lib/api/mercadopago.ts`):
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

import * as mpApi from '@/lib/api/mercadopago';
import { httpClient } from '@/lib/api/http-client';

const get = httpClient.get as unknown as ReturnType<typeof vi.fn>;
const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lib/api/mercadopago', () => {
  it('getMpStatus pega a GET /mercadopago/status', async () => {
    get.mockResolvedValue({ connected: false, enabled: false, currency: 'ARS' });

    const res = await mpApi.getMpStatus();

    expect(get).toHaveBeenCalledWith('/mercadopago/status');
    expect(res).toEqual({ connected: false, enabled: false, currency: 'ARS' });
  });

  it('connectMp pega a POST /mercadopago/connect con el accessToken (sin currency)', async () => {
    post.mockResolvedValue({ connected: true, enabled: true, currency: 'ARS' });

    await mpApi.connectMp('APP_USR-abc');

    expect(post).toHaveBeenCalledWith('/mercadopago/connect', { accessToken: 'APP_USR-abc' });
  });

  it('connectMp incluye currency en el body cuando se lo pasa', async () => {
    post.mockResolvedValue({ connected: true, enabled: true, currency: 'USD' });

    await mpApi.connectMp('APP_USR-abc', 'USD');

    expect(post).toHaveBeenCalledWith('/mercadopago/connect', { accessToken: 'APP_USR-abc', currency: 'USD' });
  });

  it('disconnectMp pega a POST /mercadopago/disconnect', async () => {
    post.mockResolvedValue({ connected: false, enabled: false, currency: 'ARS' });

    const res = await mpApi.disconnectMp();

    expect(post).toHaveBeenCalledWith('/mercadopago/disconnect', {});
    expect(res).toEqual({ connected: false, enabled: false, currency: 'ARS' });
  });

  it('createMpPaymentLink pega a POST /mercadopago/payment-link sin currency', async () => {
    post.mockResolvedValue({ url: 'https://mp.com/pay/1', id: '1' });

    const res = await mpApi.createMpPaymentLink(1500, 'Seña de turno');

    expect(post).toHaveBeenCalledWith('/mercadopago/payment-link', {
      amount: 1500,
      description: 'Seña de turno',
    });
    expect(res).toEqual({ url: 'https://mp.com/pay/1', id: '1' });
  });

  it('createMpPaymentLink incluye currency en el body cuando se lo pasa', async () => {
    post.mockResolvedValue({ url: 'https://mp.com/pay/2', id: '2' });

    await mpApi.createMpPaymentLink(2000, 'Corte + color', 'ARS');

    expect(post).toHaveBeenCalledWith('/mercadopago/payment-link', {
      amount: 2000,
      description: 'Corte + color',
      currency: 'ARS',
    });
  });
});
