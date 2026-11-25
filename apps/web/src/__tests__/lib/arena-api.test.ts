/** lib/api/arena y hook: el chat manda builderId solo si hay uno; update/delete de builders. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/http-client', () => ({
  httpClient: { post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: (...a: unknown[]) => del(...a), get: (...a: unknown[]) => get(...a) },
}));

import { sendChat, updateBuilder, deleteBuilder } from '@/lib/api/arena';
import { useArena } from '@/hooks/use-arena';

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue([]);
  post.mockResolvedValue({ reply: 'ok' });
});

describe('lib/api/arena: sendChat', () => {
  it('manda solo el mensaje cuando no hay conversación ni builder', async () => {
    await sendChat('hola');
    expect(post).toHaveBeenCalledWith('/arena/chat', { message: 'hola' });
  });

  it('incluye conversationId y builderId cuando existen', async () => {
    await sendChat('hola', 'c1', 'b1');
    expect(post).toHaveBeenCalledWith('/arena/chat', { message: 'hola', conversationId: 'c1', builderId: 'b1' });
  });

  it('puede mandar builderId sin conversación previa', async () => {
    await sendChat('hola', undefined, 'b1');
    expect(post).toHaveBeenCalledWith('/arena/chat', { message: 'hola', builderId: 'b1' });
  });

  it('update y delete de builders usan los endpoints del server', async () => {
    await updateBuilder('b1', { title: 'X' });
    await deleteBuilder('b1');
    expect(patch).toHaveBeenCalledWith('/arena/builders/b1', { title: 'X' });
    expect(del).toHaveBeenCalledWith('/arena/builders/b1');
  });
});

describe('hooks/use-arena: builders y chat', () => {
  it('updateBuilder y deleteBuilder llaman a la API y recargan la lista', async () => {
    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const loads = get.mock.calls.length;

    await act(async () => { await result.current.updateBuilder('b1', { title: 'Nuevo' }); });
    expect(patch).toHaveBeenCalledWith('/arena/builders/b1', { title: 'Nuevo' });
    await act(async () => { await result.current.deleteBuilder('b1'); });
    expect(del).toHaveBeenCalledWith('/arena/builders/b1');
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(loads));
  });

  it('sendChat del hook pasa el builderId a la API', async () => {
    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.sendChat('hey', 'c1', 'b9'); });
    expect(post).toHaveBeenCalledWith('/arena/chat', { message: 'hey', conversationId: 'c1', builderId: 'b9' });
  });
});
