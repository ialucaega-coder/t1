/**
 * AuthProvider.updateProfile: al cambiar la contraseña el server revoca el token actual y
 * devuelve uno nuevo en el body de PATCH /auth/me; el contexto tiene que guardarlo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

const httpClient = vi.hoisted(() => ({ getToken: vi.fn(), setToken: vi.fn() }));
const authApi = vi.hoisted(() => ({
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updateProfile: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/lib/api/index', () => ({ authApi, httpClient }));

import { AuthProvider, useAuth } from '@/lib/auth-context';

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

const user = { id: 'u1', name: 'Ana', email: 'ana@x.com', role: 'ADMIN' };
const business = { id: 'b1', name: 'Mi negocio' };

describe('AuthProvider.updateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpClient.getToken.mockReturnValue(null); // sin sesión previa: no se llama a getMe
  });

  it('guarda el token nuevo que devuelve el server al cambiar la contraseña', async () => {
    authApi.updateProfile.mockResolvedValue({ user, business, token: 'token-nuevo' });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateProfile({ currentPassword: 'vieja', newPassword: 'nueva-segura-123' });
    });

    expect(httpClient.setToken).toHaveBeenCalledWith('token-nuevo');
    expect(result.current.user).toEqual(user);
  });

  it('sin token en la respuesta (solo cambió el nombre) no toca el token actual', async () => {
    authApi.updateProfile.mockResolvedValue({ user: { ...user, name: 'Ana María' }, business });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateProfile({ name: 'Ana María' });
    });

    expect(httpClient.setToken).not.toHaveBeenCalled();
    expect(result.current.user?.name).toBe('Ana María');
  });

  it('si el server rechaza el cambio no cambia el token ni la sesión', async () => {
    authApi.updateProfile.mockRejectedValue(new Error('Contraseña actual incorrecta'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.updateProfile({ currentPassword: 'x', newPassword: 'y' })).rejects.toThrow(
        'Contraseña actual incorrecta',
      );
    });
    expect(httpClient.setToken).not.toHaveBeenCalled();
  });
});

describe('lib/api/auth login: cuenta bloqueada', () => {
  it('el mensaje del server ("Invalid credentials", 401) llega tal cual: no hay lógica atada al 423', async () => {
    authApi.login.mockRejectedValue(new Error('Invalid credentials'));
    httpClient.getToken.mockReturnValue(null);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.login('ana@x.com', 'mala')).rejects.toThrow('Invalid credentials');
    expect(result.current.isAuthenticated).toBe(false);
  });
});
