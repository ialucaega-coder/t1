/**
 * Pruebas unitarias para el hook `useArena` (`src/hooks/use-arena.ts`):
 * carga en paralelo de builders/ideas, error con fallback vacío, refetch,
 * create/vote/createIdea (que recargan) y sendChat (que devuelve la respuesta
 * sin recargar). Se mockea el namespace `arenaApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  arenaApi: {
    getBuilders: vi.fn(),
    getIdeas: vi.fn(),
    createBuilder: vi.fn(),
    voteIdea: vi.fn(),
    createIdea: vi.fn(),
    sendChat: vi.fn(),
  },
}));

import { useArena } from '@/hooks/use-arena';
import { arenaApi } from '@/lib/api/index';

const mockBuilders = arenaApi.getBuilders as ReturnType<typeof vi.fn>;
const mockIdeas = arenaApi.getIdeas as ReturnType<typeof vi.fn>;
const mockCreateBuilder = arenaApi.createBuilder as ReturnType<typeof vi.fn>;
const mockVote = arenaApi.voteIdea as ReturnType<typeof vi.fn>;
const mockCreateIdea = arenaApi.createIdea as ReturnType<typeof vi.fn>;
const mockSendChat = arenaApi.sendChat as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-arena', () => {
  it('inicia en estado de carga', () => {
    mockBuilders.mockReturnValue(new Promise(() => {}));
    mockIdeas.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useArena());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.builders).toEqual([]);
    expect(result.current.ideas).toEqual([]);
  });

  it('carga builders e ideas desde la API', async () => {
    mockBuilders.mockResolvedValue([{ id: 'b1' }]);
    mockIdeas.mockResolvedValue([{ id: 'i1' }]);

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.builders).toEqual([{ id: 'b1' }]);
    expect(result.current.ideas).toEqual([{ id: 'i1' }]);
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y vacía las listas', async () => {
    mockBuilders.mockRejectedValue(new Error('Caída'));
    mockIdeas.mockResolvedValue([]);

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Caída');
    expect(result.current.builders).toEqual([]);
    expect(result.current.ideas).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockBuilders.mockRejectedValue('x');
    mockIdeas.mockResolvedValue([]);

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar arena');
  });

  it('createBuilder crea y recarga', async () => {
    mockBuilders.mockResolvedValue([]);
    mockIdeas.mockResolvedValue([]);
    mockCreateBuilder.mockResolvedValue({ id: 'b2' });

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockBuilders).toHaveBeenCalledTimes(1);

    const payload = { name: 'Builder' } as never;
    await act(async () => { await result.current.createBuilder(payload); });

    expect(mockCreateBuilder).toHaveBeenCalledWith(payload);
    await waitFor(() => expect(mockBuilders).toHaveBeenCalledTimes(2));
  });

  it('voteIdea vota y recarga', async () => {
    mockBuilders.mockResolvedValue([]);
    mockIdeas.mockResolvedValue([]);
    mockVote.mockResolvedValue(undefined);

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.voteIdea('i1'); });

    expect(mockVote).toHaveBeenCalledWith('i1');
    await waitFor(() => expect(mockIdeas).toHaveBeenCalledTimes(2));
  });

  it('createIdea crea y recarga', async () => {
    mockBuilders.mockResolvedValue([]);
    mockIdeas.mockResolvedValue([]);
    mockCreateIdea.mockResolvedValue({ id: 'i2' });

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const payload = { title: 'Idea' } as never;
    await act(async () => { await result.current.createIdea(payload); });

    expect(mockCreateIdea).toHaveBeenCalledWith(payload);
    await waitFor(() => expect(mockIdeas).toHaveBeenCalledTimes(2));
  });

  it('sendChat devuelve la respuesta sin recargar', async () => {
    mockBuilders.mockResolvedValue([]);
    mockIdeas.mockResolvedValue([]);
    mockSendChat.mockResolvedValue({ reply: 'Hola' });

    const { result } = renderHook(() => useArena());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => { returned = await result.current.sendChat('hey'); });

    expect(mockSendChat).toHaveBeenCalledWith('hey');
    expect(returned).toEqual({ reply: 'Hola' });
    // No recarga las listas.
    expect(mockBuilders).toHaveBeenCalledTimes(1);
  });
});
