/**
 * Pruebas unitarias para el hook `useSkills` (`src/hooks/use-skills.ts`):
 * carga con mapeo de iconName->icono, error con fallback al catálogo local y
 * refetch. Se mockea el namespace `skillsApi` de `@/lib/api/index`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  skillsApi: {
    getSkills: vi.fn(),
  },
}));

import { useSkills } from '@/hooks/use-skills';
import { skillsApi } from '@/lib/api/index';

const mockGet = skillsApi.getSkills as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-skills', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSkills());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.skills).toEqual([]);
  });

  it('carga y mapea las skills asignando un icono', async () => {
    mockGet.mockResolvedValue([
      { name: 'Reservas', subtitle: 'Sub', description: 'Desc', isActive: true },
    ]);

    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.skills).toHaveLength(1);
    const skill = result.current.skills[0];
    expect(skill.name).toBe('Reservas');
    expect(skill.subtitle).toBe('Sub');
    expect(skill.description).toBe('Desc');
    expect(skill.isActive).toBe(true);
    expect(skill.icon).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it('ante error setea el mensaje y deja la lista vacía (sin datos falsos)', async () => {
    mockGet.mockRejectedValue(new Error('Sin conexión'));

    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Sin conexión');
    expect(result.current.skills).toEqual([]);
  });

  it('usa mensaje genérico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue(42);

    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar habilidades');
  });

  it('refetch vuelve a pedir las skills', async () => {
    mockGet.mockResolvedValue([]);

    const { result } = renderHook(() => useSkills());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
