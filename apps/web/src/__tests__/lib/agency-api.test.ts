import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/http-client', () => ({ httpClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import { getClients, AGENCY_PAGE_SIZE } from '@/lib/api/agency';

describe('lib/api/agency getClients', () => {
  beforeEach(() => get.mockReset());

  it('pide por defecto la página 1 con el pageSize máximo (100) en vez de los 20 del server', async () => {
    get.mockResolvedValue({ data: [], total: 0 });
    await getClients();
    expect(AGENCY_PAGE_SIZE).toBe(100);
    expect(get).toHaveBeenCalledWith('/agency/clients?page=1&pageSize=100');
  });

  it('manda page y search al server y devuelve data + total', async () => {
    get.mockResolvedValue({ data: [{ id: 'a' }], total: 230 });
    const res = await getClients({ page: 3, search: 'Don Juan' });
    expect(get).toHaveBeenCalledWith('/agency/clients?page=3&pageSize=100&search=Don+Juan');
    expect(res).toEqual({ data: [{ id: 'a' }], total: 230 });
  });

  it('tolera una respuesta en array plano', async () => {
    get.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    expect(await getClients()).toEqual({ data: [{ id: 'a' }, { id: 'b' }], total: 2 });
  });
});
