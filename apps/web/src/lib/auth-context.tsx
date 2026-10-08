'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi, httpClient } from './api/index';
import type { User, Business } from '@/types';

interface AuthState {
  user: User | null;
  business: Business | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<{ twoFactorRequired?: boolean }>;
  register: (data: { email: string; password: string; name: string; businessName: string }) => Promise<void>;
  updateProfile: (data: { name?: string; currentPassword?: string; newPassword?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = httpClient.getToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 <= Date.now()) {
        // Token ya expirado: limpiamos local sin pegarle al server (sería 401).
        httpClient.setToken(null);
        setIsLoading(false);
        return;
      }
    } catch {
      httpClient.setToken(null);
      setIsLoading(false);
      return;
    }
    authApi.getMe()
      .then((res) => {
        setUser(res.user);
        setBusiness(res.business);
      })
      .catch((err: unknown) => {
        // Solo cerramos sesión si el backend respondió 401 (token inválido o
        // vencido). Ante un error de red, timeout o fetch cancelado (navegar o
        // refrescar mientras /auth/me está en vuelo) NO deslogueamos:
        // preservamos el token para reintentar en la próxima carga, en vez de
        // patear al usuario a /login por un error transitorio.
        if (err instanceof Error && err.message === 'Unauthorized') {
          authApi.logout();
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string, twoFactorCode?: string) => {
    const res = await authApi.login(email, password, twoFactorCode);
    // La cuenta pide 2FA: no hay token ni user/business todavía, avisamos a la
    // página para que muestre el segundo paso (input del código).
    if (res.twoFactorRequired && !res.token) {
      return { twoFactorRequired: true };
    }
    setUser(res.user ?? null);
    setBusiness(res.business ?? null);
    return {};
  };

  const register = async (data: { email: string; password: string; name: string; businessName: string }) => {
    const res = await authApi.register(data);
    setUser(res.user);
    setBusiness(res.business);
  };

  const updateProfile = async (data: { name?: string; currentPassword?: string; newPassword?: string }) => {
    const res = await authApi.updateProfile(data);
    setUser(res.user);
    setBusiness(res.business);
  };

  const logout = async () => {
    // Esperamos el aviso al server (revoca la sesión) antes de redirigir, para
    // que el POST salga con el token todavía presente. Es best-effort: si falla,
    // authApi.logout igual limpia localmente.
    await authApi.logout();
    setUser(null);
    setBusiness(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, business, isLoading, isAuthenticated: !!user, login, register, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
