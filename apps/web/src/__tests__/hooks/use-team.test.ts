/**
 * Pruebas unitarias para el hook `useTeam` (`src/hooks/use-team.ts`):
 * carga de miembros, error, y que invite/update/remove disparen un refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  teamApi: {
    getMembers: vi.fn(),
    inviteMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
  },
}));

import { useTeam } from '@/hooks/use-team';
import { teamApi } from '@/lib/api/index';

const mockGet = teamApi.getMembers as ReturnType<typeof vi.fn>;
const mockInvite = teamApi.inviteMember as ReturnType<typeof vi.fn>;
const mockUpdate = teamApi.updateMember as ReturnType<typeof vi.fn>;
const mockRemove = teamApi.removeMember as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-team', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTeam());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.members).toEqual([]);
  });

  it('carga los miembros del equipo y normaliza el rol del backend', async () => {
    // El backend devuelve el rol como enum (ADMIN); el hook lo normaliza a la
    // etiqueta de UI (Admin) para que ROLE_CONFIG y los selects matcheen.
    mockGet.mockResolvedValue([{ id: 'm1', email: 'a@b.com', role: 'ADMIN' }]);

    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.members).toEqual([{ id: 'm1', email: 'a@b.com', role: 'Admin' }]);
    expect(result.current.error).toBeNull();
  });

  it('setea error cuando la carga falla', async () => {
    mockGet.mockRejectedValue(new Error('403'));

    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('403');
  });

  it('usa mensaje generico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue(null);

    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar miembros del equipo');
  });

  it('inviteMember llama a la API y refresca la lista', async () => {
    mockGet.mockResolvedValue([]);
    mockInvite.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.inviteMember({ email: 'nuevo@b.com', role: 'MEMBER' });
    });

    expect(mockInvite).toHaveBeenCalledWith({ email: 'nuevo@b.com', role: 'MEMBER' });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('updateMember llama a la API y refresca la lista', async () => {
    mockGet.mockResolvedValue([]);
    mockUpdate.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateMember('m1', { role: 'ADMIN' } as any);
    });

    expect(mockUpdate).toHaveBeenCalledWith('m1', { role: 'ADMIN' });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('removeMember llama a la API y refresca la lista', async () => {
    mockGet.mockResolvedValue([]);
    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeMember('m1');
    });

    expect(mockRemove).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
