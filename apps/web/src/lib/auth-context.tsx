'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi, httpClient } from './api/index';
import type { User, Business } from '@/types';

interface AuthState {
  user: User | null;
  business: Business | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; businessName: string }) => Promise<void>;
  updateProfile: (data: { name?: string; currentPassword?: string; newPassword?: string }) => Promise<void>;
  logout: () => void;
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
        authApi.logout();
        setIsLoading(false);
        return;
      }
    } catch {
      authApi.logout();
      setIsLoading(false);
      return;
    }
    authApi.getMe()
      .then((res) => {
        setUser(res.user);
        setBusiness(res.business);
      })
      .catch(() => {
        authApi.logout();
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setUser(res.user);
    setBusiness(res.business);
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

  const logout = () => {
    authApi.logout();
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
