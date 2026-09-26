export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// Nombre de la cookie "espejo" del token, en el dominio del propio
// frontend (no es la cookie httpOnly que emite la API, que vive en
// otro dominio/puerto y por lo tanto no es visible para Next.js).
// El middleware de Next (apps/web/src/middleware.ts) solo puede leer
// cookies, nunca localStorage, así que reflejamos aquí la presencia
// del token para poder proteger rutas a nivel de edge/servidor. No
// es una fuente de verdad de seguridad: la validación real del JWT
// siempre ocurre en la API (Authorization: Bearer ...).
const MIRROR_COOKIE_NAME = 'auth_token';
const MIRROR_COOKIE_MAX_AGE_S = 14 * 24 * 60 * 60; // 14 días, igual que el JWT

function setMirrorCookie(token: string | null) {
  if (typeof document === 'undefined') return;
  if (token) {
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${MIRROR_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${MIRROR_COOKIE_MAX_AGE_S}; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${MIRROR_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

export class HttpClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      if (typeof window !== 'undefined') localStorage.setItem('auth_token', token);
    } else {
      if (typeof window !== 'undefined') localStorage.removeItem('auth_token');
    }
    setMirrorCookie(token);
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.setToken(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    if (res.status === 204) return null as T;
    return res.json();
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown, headers?: Record<string, string>) {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body), headers });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const httpClient = new HttpClient();
