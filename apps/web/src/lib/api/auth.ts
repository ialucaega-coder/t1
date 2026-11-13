import { httpClient } from './http-client';
import type { User, Business } from '@/types';

// Respuesta del login: si la cuenta tiene 2FA activo y no se mandó el código,
// la API responde 200 con { twoFactorRequired: true } y SIN token.
export interface LoginResponse {
  token?: string;
  user?: User;
  business?: Business;
  twoFactorRequired?: boolean;
}

export async function login(email: string, password: string, twoFactorCode?: string) {
  const res = await httpClient.post<LoginResponse>('/auth/login', {
    email,
    password,
    // Solo mandamos el código cuando el usuario ya lo ingresó (segundo paso).
    ...(twoFactorCode ? { twoFactorCode } : {}),
  });
  // Cuando viene twoFactorRequired no hay token: no lo seteamos.
  if (res.token) httpClient.setToken(res.token);
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

export async function logout() {
  // Avisamos al server para que revoque la sesión (best-effort): aunque el
  // token siga sin expirar, queda inutilizable. Si la llamada falla (red caída,
  // token ya inválido), igual limpiamos localmente para no trabar el logout.
  try {
    await httpClient.post('/auth/logout', {});
  } catch {
    // Ignorado a propósito: el logout local no debe depender del server.
  }
  httpClient.setToken(null);
}

// --- Autenticación en dos pasos (2FA / TOTP) ---

// Devuelve si la cuenta tiene el 2FA activado y cuántos códigos de recuperación
// sin usar le quedan.
export function getTwoFactorStatus() {
  return httpClient.get<{ enabled: boolean; recoveryCodesRemaining?: number }>('/auth/2fa/status');
}

// Inicia el alta: devuelve el QR (data URL listo para <img>) y el otpauth URI
// como fallback copiable para apps autenticadoras.
export function setupTwoFactor() {
  return httpClient.post<{ otpauthUri: string; qrDataUrl: string }>('/auth/2fa/setup', {});
}

// Verifica el código de 6 dígitos y activa el 2FA. Lanza (400) si es inválido.
// Devuelve los códigos de recuperación EN CLARO: es la única vez que se ven.
export function verifyTwoFactor(code: string) {
  return httpClient.post<{ enabled: boolean; recoveryCodes: string[] }>('/auth/2fa/verify', { code });
}

// Desactiva el 2FA pidiendo un código válido (6 dígitos o código de
// recuperación). Lanza (400) si es inválido.
export function disableTwoFactor(code: string) {
  return httpClient.post<{ enabled: boolean }>('/auth/2fa/disable', { code });
}

// Emite un juego nuevo de códigos de recuperación (invalida los anteriores).
// Pide un segundo factor vigente (6 dígitos o código de recuperación).
export function regenerateRecoveryCodes(code: string) {
  return httpClient.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { code });
}
