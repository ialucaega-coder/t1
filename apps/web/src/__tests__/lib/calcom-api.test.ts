/**
 * Pruebas del cliente de Cal.com (`src/lib/api/calcom.ts`):
 * verifica que cada función pegue al path correcto con el método correcto.
 * Se mockea `httpClient` para inspeccionar las llamadas sin tocar la red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del cliente HTTP: controlamos get/post.
vi.mock('@/lib/api/http-client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import * as calcomApi from '@/lib/api/calcom';
import { httpClient } from '@/lib/api/http-client';

const get = httpClient.get as unknown as ReturnType<typeof vi.fn>;
const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lib/api/calcom', () => {
  it('getCalcomStatus pega a GET /calcom/status', async () => {
    get.mockResolvedValue({ connected: false, enabled: false, eventTypeId: null });

    const res = await calcomApi.getCalcomStatus();

    expect(get).toHaveBeenCalledWith('/calcom/status');
    expect(res).toEqual({ connected: false, enabled: false, eventTypeId: null });
  });

  it('getCalcomEventTypes pega a GET /calcom/event-types', async () => {
    get.mockResolvedValue({ eventTypes: [{ id: 1, title: 'Demo', slug: 'demo', length: 30 }] });

    const res = await calcomApi.getCalcomEventTypes();

    expect(get).toHaveBeenCalledWith('/calcom/event-types');
    expect(res.eventTypes).toHaveLength(1);
  });

  it('connectCalcom pega a POST /calcom/connect con la apiKey (sin eventTypeId)', async () => {
    post.mockResolvedValue({ connected: true, enabled: true, eventTypeId: null });

    await calcomApi.connectCalcom('cal_live_abc');

    expect(post).toHaveBeenCalledWith('/calcom/connect', { apiKey: 'cal_live_abc' });
  });

  it('connectCalcom incluye eventTypeId en el body cuando se lo pasa', async () => {
    post.mockResolvedValue({ connected: true, enabled: true, eventTypeId: 42 });

    await calcomApi.connectCalcom('cal_live_abc', 42);

    expect(post).toHaveBeenCalledWith('/calcom/connect', { apiKey: 'cal_live_abc', eventTypeId: 42 });
  });

  it('disconnectCalcom pega a POST /calcom/disconnect', async () => {
    post.mockResolvedValue({ connected: false, enabled: false, eventTypeId: null });

    const res = await calcomApi.disconnectCalcom();

    expect(post).toHaveBeenCalledWith('/calcom/disconnect', {});
    expect(res).toEqual({ connected: false, enabled: false, eventTypeId: null });
  });
});
