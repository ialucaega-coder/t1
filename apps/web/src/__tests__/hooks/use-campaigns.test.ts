/**
 * Pruebas unitarias para el hook `useCampaigns` (`src/hooks/use-campaigns.ts`):
 * carga, error, refetch y create/update/delete/send (que recargan la lista tras
 * la operación). Se mockea el módulo de API `@/lib/api/campaigns`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/campaigns', () => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
}));

import { useCampaigns } from '@/hooks/use-campaigns';
import * as campaignsApi from '@/lib/api/campaigns';

const mockList = campaignsApi.list as ReturnType<typeof vi.fn>;
const mockCreate = campaignsApi.create as ReturnType<typeof vi.fn>;
const mockUpdate = campaignsApi.update as ReturnType<typeof vi.fn>;
const mockRemove = campaignsApi.remove as ReturnType<typeof vi.fn>;
const mockSend = campaignsApi.send as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-campaigns', () => {
  it('inicia en estado de carga', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCampaigns());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.campaigns).toEqual([]);
  });

  it('carga las campañas desde la API', async () => {
    const fake = [{ id: 'c1', name: 'Promo' }];
    mockList.mockResolvedValue(fake);

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.campaigns).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y vacía la lista', async () => {
    mockList.mockRejectedValue(new Error('Falló'));

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Falló');
    expect(result.current.campaigns).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockList.mockRejectedValue(0);

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar campañas');
  });

  it('createCampaign crea y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'c2' });

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockList).toHaveBeenCalledTimes(1);

    const payload = { name: 'Nueva', description: null, channel: 'EMAIL' };
    await act(async () => { await result.current.createCampaign(payload); });

    expect(mockCreate).toHaveBeenCalledWith(payload);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('updateCampaign actualiza y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({ id: 'c1' });

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.updateCampaign('c1', { name: 'Editada' }); });

    expect(mockUpdate).toHaveBeenCalledWith('c1', { name: 'Editada' });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('deleteCampaign elimina y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.deleteCampaign('c1'); });

    expect(mockRemove).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('sendCampaign envía y recarga la lista', async () => {
    mockList.mockResolvedValue([]);
    mockSend.mockResolvedValue({ id: 'c1' });

    const { result } = renderHook(() => useCampaigns());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.sendCampaign('c1'); });

    expect(mockSend).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});
