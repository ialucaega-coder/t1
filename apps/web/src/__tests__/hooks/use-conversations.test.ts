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

  it('loadMore acumula la página siguiente sin repetir ids y respeta hasMore', async () => {
    mockList
      .mockResolvedValueOnce({ data: [{ id: 'c1' }, { id: 'c2' }], total: 3, page: 1, pageSize: 2 })
      .mockResolvedValueOnce({ data: [{ id: 'c2' }, { id: 'c3' }], total: 3, page: 2, pageSize: 2 });

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.conversations).toHaveLength(3));

    expect(result.current.conversations.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(result.current.hasMore).toBe(false);
  });

  it('el refresco silencioso vuelve a pedir las páginas 1..N y reemplaza la lista', async () => {
    mockList
      .mockResolvedValueOnce({ data: [{ id: 'c1' }], total: 2, page: 1, pageSize: 1 })
      .mockResolvedValueOnce({ data: [{ id: 'c2' }], total: 2, page: 2, pageSize: 1 });

    const { result } = renderHook(() => useConversations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));
    mockList.mockClear();

    // Llega una conversación nueva: sube a la cabeza y desplaza a c2 a la página 2.
    mockList
      .mockResolvedValueOnce({ data: [{ id: 'c0' }], total: 3, page: 1, pageSize: 1 })
      .mockResolvedValueOnce({ data: [{ id: 'c1' }], total: 3, page: 2, pageSize: 1 });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.conversations.map((c) => c.id)).toEqual(['c0', 'c1']));

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(result.current.total).toBe(3);
    expect(result.current.isLoading).toBe(false);
  });

  it('al cambiar un filtro vuelve a la página 1', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });

    const { result, rerender } = renderHook(({ s }) => useConversations({ search: s }), {
      initialProps: { s: '' },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ page: 3 })));

    rerender({ s: 'ana' });
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ page: 1, search: 'ana' })),
    );
    expect(result.current.page).toBe(1);
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

    expect(mockGetById).toHaveBeenCalledWith('c1', { limit: 50 });
    expect(result.current.detail).toEqual({ id: 'c1', messages: [] });
  });

  it('ante error setea el mensaje', async () => {
    mockGetById.mockRejectedValue(new Error('No existe'));

    const { result } = renderHook(() => useConversationDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('No existe');
  });

  it('loadOlder antepone los mensajes anteriores usando el id del más viejo como cursor', async () => {
    mockGetById
      .mockResolvedValueOnce({ id: 'c1', hasMoreMessages: true, messages: [{ id: 'm3' }, { id: 'm4' }] })
      .mockResolvedValueOnce({ id: 'c1', hasMoreMessages: false, messages: [{ id: 'm1' }, { id: 'm2' }] });

    const { result } = renderHook(() => useConversationDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMoreMessages).toBe(true);

    await act(async () => { await result.current.loadOlder(); });

    expect(mockGetById).toHaveBeenLastCalledWith('c1', { limit: 50, before: 'm3' });
    expect(result.current.detail?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(result.current.hasMoreMessages).toBe(false);
    expect(result.current.prependCount).toBe(1);
  });

  it('un refetch conserva los mensajes anteriores ya cargados', async () => {
    mockGetById
      .mockResolvedValueOnce({ id: 'c1', hasMoreMessages: true, messages: [{ id: 'm3' }, { id: 'm4' }] })
      .mockResolvedValueOnce({ id: 'c1', hasMoreMessages: false, messages: [{ id: 'm1' }, { id: 'm2' }] })
      // refetch: el server devuelve la tanda más reciente (con un mensaje nuevo m5).
      .mockResolvedValueOnce({ id: 'c1', hasMoreMessages: true, messages: [{ id: 'm3' }, { id: 'm4' }, { id: 'm5' }] });

    const { result } = renderHook(() => useConversationDetail('c1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.loadOlder(); });

    act(() => result.current.refetchDetail());
    await waitFor(() => expect(result.current.detail?.messages).toHaveLength(5));

    expect(result.current.detail?.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    // Sigue sin haber más anteriores: lo sabíamos tras cargar la tanda vieja.
    expect(result.current.hasMoreMessages).toBe(false);
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
