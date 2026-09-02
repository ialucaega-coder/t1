import { httpClient } from './http-client';
import type { User, Business } from '@/types';

export async function login(email: string, password: string) {
  const res = await httpClient.post<{ token: string; user: User; business: Business }>('/auth/login', {
    email,
    password,
  });
  httpClient.setToken(res.token);
  return res;
}

export async function register(data: { email: string; password: string; name: string; businessName: string }) {
  const res = await httpClient.post<{ token: string; user: User; business: Business }>('/auth/register', data);
  httpClient.setToken(res.token);
  return res;
}

export function getMe() {
  return httpClient.get<{ user: User; business: Business }>('/auth/me');
}

export function updateProfile(data: { name?: string; currentPassword?: string; newPassword?: string }) {
  return httpClient.patch<{ user: User; business: Business }>('/auth/me', data);
}

export function logout() {
  httpClient.setToken(null);
}
