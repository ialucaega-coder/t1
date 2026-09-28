/**
 * Pruebas de los hooks de conversaciones (`src/hooks/use-conversations.ts`):
 * `useConversations` (listado paginado con filtros, cerrar conversación) y
 * `useConversationDetail` (detalle por id con recarga). Se mockea el módulo
 * de API de conversaciones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/conversations', () => ({
  list: vi.fn(),
  close: vi.fn(),
  getById: vi.fn(),
}));

import { useConversations, useConversationDetail } from '@/hooks/use-conversations';
import * as conversationsApi from '@/lib/api/conversations';

const mockList = conversationsApi.list as ReturnType<typeof vi.fn>;
const mockClose = conversationsApi.close as ReturnType<typeof vi.fn>;
const mockGetById = conversationsApi.getById as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/useConversations', () => {
  it('inicia en estado de carga', () => {
    mockList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useConversations());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.conversations).toEqual([]);
  });

  it('carga el listado y el total desde la API', async () => {
    mockList.mockResolvedValue({ data: [{ id: 'c1' }], total: 1 });

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.conversations).toEqual([{ id: 'c1' }]);
    expect(result.current.total).toBe(1);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('pasa los filtros de status y channel a la API', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });

    renderHook(() => useConversations({ status: 'OPEN', channel: 'WHATSAPP' }));
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, status: 'OPEN', channel: 'WHATSAPP' })
    );
  });

  it('ante error setea el mensaje y vacía el listado', async () => {
    mockList.mockRejectedValue(new Error('Sin conexión'));

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin conexión');
    expect(result.current.conversations).toEqual([]);
  });

  it('setPage vuelve a pedir el listado con la nueva página', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(2));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('closeConversation cierra por id y recarga el listado', async () => {
    mockList.mockResolvedValue({ data: [{ id: 'c1' }], total: 1 });
    mockClose.mockResolvedValue(undefined);

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockList).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.closeConversation('c1'); });

    expect(mockClose).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});

describe('hooks/useConversationDetail', () => {
  it('con id null no llama a la API y no carga', () => {
    const { result } = renderHook(() => useConversationDetail(null));

    expect(result.current.detail).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it('carga el detalle cuando hay id', async () => {
    mockGetById.mockResolvedValue({ id: 'c1', messages: [] });

    const { result } = renderHook(() => useConversationDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetById).toHaveBeenCalledWith('c1');
    expect(result.current.detail).toEqual({ id: 'c1', messages: [] });
  });

  it('ante error setea el mensaje', async () => {
    mockGetById.mockRejectedValue(new Error('No existe'));

    const { result } = renderHook(() => useConversationDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('No existe');
  });

  it('refetchDetail vuelve a pedir el detalle', async () => {
    mockGetById.mockResolvedValue({ id: 'c1', messages: [] });

    const { result } = renderHook(() => useConversationDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetById).toHaveBeenCalledTimes(1);

    act(() => result.current.refetchDetail());
    await waitFor(() => expect(mockGetById).toHaveBeenCalledTimes(2));
  });
});
